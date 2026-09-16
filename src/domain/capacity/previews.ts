import type {
  ActionImpact,
  ActionPreview,
  ActionWarning,
  CapacityDataSet,
  ConsultantDto,
  DemandDto,
  FieldChange,
  JsonValue,
  ProposedAction,
  ResolvedAction,
  RowVersion,
  StaffingSnapshot,
} from "./contracts";
import { sha256 } from "./digest";
import { CapacityActionFailure } from "./errors";
import { capacityWarnings, getCapacitySnapshot, getStaffingSnapshot } from "./metrics";
import { demandConsumesCapacityOn, demandOverlapsRange } from "./rules";
import { resolveAvailabilityBlock, resolveConsultant, resolveDemand } from "./resolution";
import { availabilityRangesOverlap, isDateRangeOrdered, normalizeSkills } from "./form-validation";

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function change(changes: FieldChange[], field: string, before: unknown, after: unknown) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    changes.push({ field, before: json(before), after: json(after) });
  }
}

function rowVersions(data: CapacityDataSet): RowVersion[] {
  return [
    ...data.consultants.map((row) => ({
      table: "consultants" as const,
      id: row.id,
      updatedAt: row.updatedAt,
    })),
    ...data.demands.map((row) => ({
      table: "demands" as const,
      id: row.id,
      updatedAt: row.updatedAt,
    })),
    ...data.allocations.map((row) => ({
      table: "allocations" as const,
      id: row.id,
      updatedAt: row.updatedAt,
    })),
    ...data.availabilityBlocks.map((row) => ({
      table: "availability_blocks" as const,
      id: row.id,
      updatedAt: row.updatedAt,
    })),
  ].sort((a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id));
}

function preconditionsMatchSnapshot(current: CapacityDataSet, expected: RowVersion[]): boolean {
  return expected.every((version) => {
    const rows =
      version.table === "consultants"
        ? current.consultants
        : version.table === "demands"
          ? current.demands
          : version.table === "allocations"
            ? current.allocations
            : current.availabilityBlocks;
    const row = rows.find((item) => item.id === version.id);
    if (!row || row.updatedAt !== version.updatedAt) return false;
    return !version.stateFingerprint || JSON.stringify(row) === version.stateFingerprint;
  });
}

function patchConsultant(
  consultant: ConsultantDto,
  patch: Extract<ResolvedAction, { kind: "updateConsultant" }>["patch"],
): ConsultantDto {
  return {
    ...consultant,
    name: patch.name ?? consultant.name,
    surname: patch.surname ?? consultant.surname,
    email: patch.email !== undefined ? patch.email : consultant.email,
    level: patch.level ?? consultant.level,
    role: patch.role ?? consultant.role,
    skills: patch.skills ?? consultant.skills,
    workingCapacity: patch.workingCapacity ?? consultant.workingCapacity,
    archivedAt:
      patch.archived === undefined ? consultant.archivedAt : patch.archived ? "preview" : null,
  };
}

function patchDemand(
  demand: DemandDto,
  patch: Extract<ResolvedAction, { kind: "updateDemand" }>["patch"],
  consultants: ConsultantDto[],
): DemandDto {
  const owner =
    patch.ownerConsultantId === undefined
      ? demand.owner
      : patch.ownerConsultantId
        ? (consultants.find((consultant) => consultant.id === patch.ownerConsultantId) ?? null)
        : null;
  return {
    ...demand,
    title: patch.title ?? demand.title,
    client: patch.client ?? demand.client,
    type: patch.type ?? demand.type,
    status: patch.status ?? demand.status,
    description: patch.description ?? demand.description,
    skills: patch.skills ?? demand.skills,
    startDate: patch.startDate !== undefined ? patch.startDate : demand.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate : demand.endDate,
    requiredCapacity: patch.requiredCapacity ?? demand.requiredCapacity,
    owner: owner
      ? { id: owner.id, name: owner.name, surname: owner.surname, archivedAt: owner.archivedAt }
      : null,
  };
}

function allocationFor(data: CapacityDataSet, consultantId: string, demandId: string) {
  return data.allocations.find(
    (allocation) => allocation.consultantId === consultantId && allocation.demandId === demandId,
  );
}

function validateEmailUniqueness(
  data: CapacityDataSet,
  consultantId: string,
  email?: string | null,
) {
  if (!email) return;
  const match = data.consultants.find(
    (consultant) =>
      consultant.id !== consultantId && consultant.email?.toLowerCase() === email.toLowerCase(),
  );
  if (match) throw new CapacityActionFailure("CONFLICT", "A consultant already uses this email");
}

function validateNewConsultantEmailUniqueness(data: CapacityDataSet, email?: string | null) {
  if (!email) return;
  const normalized = email.trim().toLowerCase();
  if (
    data.consultants.some((consultant) => consultant.email?.trim().toLowerCase() === normalized)
  ) {
    throw new CapacityActionFailure(
      "CONFLICT",
      "A consultant already uses this email. Ask them to join or link that profile instead.",
      { field: "consultant.email" },
    );
  }
}

function resolveAction(action: ProposedAction, data: CapacityDataSet): ResolvedAction {
  switch (action.kind) {
    case "createConsultant": {
      validateNewConsultantEmailUniqueness(data, action.consultant.email);
      return {
        kind: action.kind,
        consultant: {
          name: action.consultant.name.trim(),
          surname: action.consultant.surname.trim(),
          email: action.consultant.email?.trim().toLowerCase() ?? null,
          level: action.consultant.level ?? "Consultant",
          role: action.consultant.role ?? "Strategy",
          skills: normalizeSkills(action.consultant.skills ?? []),
          workingCapacity: action.consultant.workingCapacity ?? 100,
        },
      };
    }
    case "updateConsultant": {
      const consultant = resolveConsultant(action.consultant, data.consultants, {
        field: "consultant",
      });
      validateEmailUniqueness(data, consultant.id, action.patch.email);
      return {
        kind: action.kind,
        consultantId: consultant.id,
        patch: action.patch.skills
          ? { ...action.patch, skills: normalizeSkills(action.patch.skills) }
          : action.patch,
      };
    }
    case "createDemand": {
      if (!isDateRangeOrdered(action.demand.startDate ?? null, action.demand.endDate ?? null)) {
        throw new CapacityActionFailure(
          "VALIDATION_ERROR",
          "End date cannot be before start date",
          {
            field: "endDate",
          },
        );
      }
      const owner = action.demand.owner
        ? resolveConsultant(action.demand.owner, data.consultants, {
            activeOnly: true,
            field: "demand.owner",
          })
        : null;
      const { owner: _owner, ...demand } = action.demand;
      return {
        kind: action.kind,
        demand: { ...demand, ownerConsultantId: owner?.id ?? null },
      };
    }
    case "updateDemand": {
      const demand = resolveDemand(action.demand, data.demands, { field: "demand" });
      const owner = action.patch.owner
        ? resolveConsultant(action.patch.owner, data.consultants, {
            activeOnly: true,
            field: "patch.owner",
          })
        : null;
      const { owner: ownerRef, ...patch } = action.patch;
      const resolvedPatch = {
        ...patch,
        ...(ownerRef !== undefined ? { ownerConsultantId: owner?.id ?? null } : {}),
      };
      const nextStart =
        resolvedPatch.startDate !== undefined ? resolvedPatch.startDate : demand.startDate;
      const nextEnd = resolvedPatch.endDate !== undefined ? resolvedPatch.endDate : demand.endDate;
      if (!isDateRangeOrdered(nextStart, nextEnd)) {
        throw new CapacityActionFailure(
          "VALIDATION_ERROR",
          "End date cannot be before start date",
          {
            field: "endDate",
          },
        );
      }
      return { kind: action.kind, demandId: demand.id, patch: resolvedPatch };
    }
    case "setAllocation": {
      const consultant = resolveConsultant(action.consultant, data.consultants, {
        activeOnly: true,
        field: "consultant",
      });
      const demand = resolveDemand(action.demand, data.demands, { field: "demand" });
      const existing = allocationFor(data, consultant.id, demand.id);
      return {
        kind: action.kind,
        allocationId: existing?.id ?? null,
        consultantId: consultant.id,
        demandId: demand.id,
        capacity: action.capacity,
      };
    }
    case "removeAllocation": {
      const consultant = resolveConsultant(action.consultant, data.consultants, {
        field: "consultant",
      });
      const demand = resolveDemand(action.demand, data.demands, { field: "demand" });
      const existing = allocationFor(data, consultant.id, demand.id);
      if (!existing) throw new CapacityActionFailure("NOT_FOUND", "Allocation not found");
      return {
        kind: action.kind,
        allocationId: existing.id,
        consultantId: consultant.id,
        demandId: demand.id,
      };
    }
    case "addAvailabilityBlock": {
      if (!isDateRangeOrdered(action.startDate, action.endDate)) {
        throw new CapacityActionFailure(
          "VALIDATION_ERROR",
          "End date cannot be before start date",
          {
            field: "endDate",
          },
        );
      }
      const consultant = resolveConsultant(action.consultant, data.consultants, {
        activeOnly: true,
        field: "consultant",
      });
      const overlaps = data.availabilityBlocks.some(
        (block) =>
          block.consultantId === consultant.id &&
          availabilityRangesOverlap(block, {
            startDate: action.startDate,
            endDate: action.endDate,
          }),
      );
      if (overlaps) {
        throw new CapacityActionFailure(
          "CONFLICT",
          "Availability block overlaps an existing block",
        );
      }
      return {
        kind: action.kind,
        consultantId: consultant.id,
        startDate: action.startDate,
        endDate: action.endDate,
        note: action.note ?? "",
      };
    }
    case "removeAvailabilityBlock": {
      if (
        "consultant" in action.block &&
        !isDateRangeOrdered(action.block.startDate, action.block.endDate)
      ) {
        throw new CapacityActionFailure(
          "VALIDATION_ERROR",
          "End date cannot be before start date",
          {
            field: "block.endDate",
          },
        );
      }
      const block = resolveAvailabilityBlock(
        action.block,
        data.availabilityBlocks,
        data.consultants,
        { field: "block" },
      );
      return { kind: action.kind, availabilityBlockId: block.id };
    }
  }
}

function afterData(data: CapacityDataSet, action: ResolvedAction): CapacityDataSet {
  const next = structuredClone(data);
  switch (action.kind) {
    case "createConsultant":
      next.consultants.push({
        id: "preview-consultant",
        name: action.consultant.name,
        surname: action.consultant.surname,
        email: action.consultant.email,
        level: action.consultant.level,
        role: action.consultant.role,
        skills: action.consultant.skills,
        workingCapacity: action.consultant.workingCapacity,
        archivedAt: null,
        linkedToUser: false,
        isCurrentUser: false,
        createdAt: "preview",
        updatedAt: "preview",
      });
      break;
    case "updateConsultant":
      next.consultants = next.consultants.map((consultant) =>
        consultant.id === action.consultantId
          ? patchConsultant(consultant, action.patch)
          : consultant,
      );
      break;
    case "createDemand":
      break;
    case "updateDemand":
      next.demands = next.demands.map((demand) =>
        demand.id === action.demandId
          ? patchDemand(demand, action.patch, next.consultants)
          : demand,
      );
      break;
    case "setAllocation": {
      const existing = next.allocations.find((allocation) => allocation.id === action.allocationId);
      if (existing) existing.capacity = action.capacity;
      else {
        next.allocations.push({
          id: "preview-allocation",
          consultantId: action.consultantId,
          demandId: action.demandId,
          capacity: action.capacity,
          createdAt: "preview",
          updatedAt: "preview",
        });
      }
      break;
    }
    case "removeAllocation":
      next.allocations = next.allocations.filter(
        (allocation) => allocation.id !== action.allocationId,
      );
      break;
    case "addAvailabilityBlock":
      next.availabilityBlocks.push({
        id: "preview-block",
        consultantId: action.consultantId,
        startDate: action.startDate,
        endDate: action.endDate,
        note: action.note,
        createdAt: "preview",
        updatedAt: "preview",
      });
      break;
    case "removeAvailabilityBlock":
      next.availabilityBlocks = next.availabilityBlocks.filter(
        (block) => block.id !== action.availabilityBlockId,
      );
      break;
  }
  return next;
}

function changesFor(data: CapacityDataSet, action: ResolvedAction): FieldChange[] {
  const changes: FieldChange[] = [];
  switch (action.kind) {
    case "createConsultant":
      for (const [field, value] of Object.entries(action.consultant)) {
        change(changes, field, null, value);
      }
      break;
    case "updateConsultant": {
      const consultant = data.consultants.find((item) => item.id === action.consultantId)!;
      const after = patchConsultant(consultant, action.patch);
      for (const field of [
        "name",
        "surname",
        "email",
        "level",
        "role",
        "skills",
        "workingCapacity",
      ] as const) {
        change(changes, field, consultant[field], after[field]);
      }
      if (action.patch.archived !== undefined)
        change(changes, "archived", !!consultant.archivedAt, action.patch.archived);
      break;
    }
    case "createDemand":
      for (const [field, value] of Object.entries(action.demand))
        change(changes, field, null, value);
      break;
    case "updateDemand": {
      const demand = data.demands.find((item) => item.id === action.demandId)!;
      const after = patchDemand(demand, action.patch, data.consultants);
      for (const field of [
        "title",
        "client",
        "type",
        "status",
        "description",
        "skills",
        "startDate",
        "endDate",
        "requiredCapacity",
      ] as const) {
        change(changes, field, demand[field], after[field]);
      }
      change(changes, "ownerConsultantId", demand.owner?.id ?? null, after.owner?.id ?? null);
      break;
    }
    case "setAllocation": {
      const existing = data.allocations.find((allocation) => allocation.id === action.allocationId);
      change(changes, "capacity", existing?.capacity ?? null, action.capacity);
      break;
    }
    case "removeAllocation": {
      const existing = data.allocations.find(
        (allocation) => allocation.id === action.allocationId,
      )!;
      change(changes, "allocation", existing.capacity, null);
      break;
    }
    case "addAvailabilityBlock":
      change(changes, "availabilityBlock", null, {
        consultantId: action.consultantId,
        startDate: action.startDate,
        endDate: action.endDate,
        note: action.note,
      });
      break;
    case "removeAvailabilityBlock": {
      const block = data.availabilityBlocks.find((item) => item.id === action.availabilityBlockId)!;
      change(changes, "availabilityBlock", block, null);
      break;
    }
  }
  return changes;
}

function relevantIds(data: CapacityDataSet, action: ResolvedAction) {
  const consultantIds = new Set<string>();
  const demandIds = new Set<string>();
  switch (action.kind) {
    case "updateConsultant":
      consultantIds.add(action.consultantId);
      data.allocations
        .filter((allocation) => allocation.consultantId === action.consultantId)
        .forEach((allocation) => demandIds.add(allocation.demandId));
      break;
    case "createDemand":
      break;
    case "updateDemand":
      demandIds.add(action.demandId);
      data.allocations
        .filter((allocation) => allocation.demandId === action.demandId)
        .forEach((allocation) => consultantIds.add(allocation.consultantId));
      break;
    case "setAllocation":
    case "removeAllocation":
      consultantIds.add(action.consultantId);
      demandIds.add(action.demandId);
      break;
    case "addAvailabilityBlock":
      consultantIds.add(action.consultantId);
      break;
    case "removeAvailabilityBlock": {
      const block = data.availabilityBlocks.find((item) => item.id === action.availabilityBlockId);
      if (block) consultantIds.add(block.consultantId);
      break;
    }
  }
  return { consultantIds, demandIds };
}

export function computeActionImpact(
  before: CapacityDataSet,
  after: CapacityDataSet,
  action: ResolvedAction,
  asOfDate: string,
): ActionImpact {
  const { consultantIds, demandIds } = relevantIds(before, action);
  const capacity = [...consultantIds].flatMap((id) => {
    const beforeConsultant = before.consultants.find((item) => item.id === id);
    const afterConsultant = after.consultants.find((item) => item.id === id);
    return beforeConsultant && afterConsultant
      ? [
          {
            consultantId: id,
            before: getCapacitySnapshot(before, beforeConsultant, asOfDate, false),
            after: getCapacitySnapshot(after, afterConsultant, asOfDate, false),
          },
        ]
      : [];
  });
  if (action.kind === "addAvailabilityBlock") {
    for (const item of capacity) item.after.availabilityBlockId = null;
  }
  const staffing: ActionImpact["staffing"] = [...demandIds].flatMap((id) => {
    const beforeDemand = before.demands.find((item) => item.id === id);
    const afterDemand = after.demands.find((item) => item.id === id);
    return beforeDemand && afterDemand
      ? [
          {
            demandId: id,
            before: getStaffingSnapshot(before, beforeDemand),
            after: getStaffingSnapshot(after, afterDemand),
          },
        ]
      : [];
  });
  if (action.kind === "createDemand") {
    const required = action.demand.requiredCapacity ?? 100;
    const empty: StaffingSnapshot = {
      requiredCapacity: required,
      staffedCapacity: 0,
      gapCapacity: required,
      overTargetCapacity: 0,
      staffingPercent: required > 0 ? 0 : null,
    };
    staffing.push({
      demandId: null,
      before: { ...empty, requiredCapacity: 0, gapCapacity: 0, staffingPercent: null },
      after: empty,
    });
  }
  const affectedAllocations: ActionImpact["affectedAllocations"] = before.allocations
    .filter(
      (allocation) =>
        consultantIds.has(allocation.consultantId) || demandIds.has(allocation.demandId),
    )
    .map((allocation) => ({
      allocationId: allocation.id,
      consultantId: allocation.consultantId,
      demandId: allocation.demandId,
      capacity: allocation.capacity,
    }));
  if (action.kind === "setAllocation" && !action.allocationId) {
    affectedAllocations.push({
      allocationId: null,
      consultantId: action.consultantId,
      demandId: action.demandId,
      capacity: action.capacity,
    });
  }
  return { capacity, staffing, affectedAllocations };
}

function warningsFor(
  data: CapacityDataSet,
  action: ResolvedAction,
  asOfDate: string,
): ActionWarning[] {
  switch (action.kind) {
    case "createConsultant":
      return [];
    case "setAllocation": {
      const consultant = data.consultants.find((item) => item.id === action.consultantId)!;
      const demand = data.demands.find((item) => item.id === action.demandId)!;
      return capacityWarnings(data, consultant, demand, action.capacity, asOfDate);
    }
    case "updateConsultant": {
      if (!action.patch.archived) return [];
      const count = data.allocations.filter(
        (allocation) => allocation.consultantId === action.consultantId,
      ).length;
      return count
        ? [
            {
              code: "ARCHIVE_WITH_HISTORY",
              message: `Archiving preserves ${count} allocation(s) as history`,
            },
          ]
        : [];
    }
    case "addAvailabilityBlock": {
      const affected = data.allocations.filter((allocation) => {
        if (allocation.consultantId !== action.consultantId) return false;
        const demand = data.demands.find((item) => item.id === allocation.demandId);
        return (
          !!demand &&
          (demand.status === "Incoming" ||
            demand.status === "Won" ||
            demand.status === "In Progress") &&
          demandOverlapsRange(
            { ...demand, ownerConsultantId: demand.owner?.id ?? null },
            action.startDate,
            action.endDate,
          )
        );
      });
      return affected.length
        ? [
            {
              code: "AFFECTED_ACTIVE_WORK",
              message: `${affected.length} allocation(s) overlap this unavailable period`,
            },
          ]
        : [];
    }
    case "updateDemand": {
      const next = afterData(data, action);
      const demand = next.demands.find((item) => item.id === action.demandId)!;
      const warnings: ActionWarning[] = [];
      for (const allocation of next.allocations.filter(
        (item) => item.demandId === action.demandId,
      )) {
        const consultant = next.consultants.find((item) => item.id === allocation.consultantId);
        if (!consultant || consultant.archivedAt) continue;
        if (
          !demandConsumesCapacityOn(
            { ...demand, ownerConsultantId: demand.owner?.id ?? null },
            asOfDate,
          )
        )
          continue;
        const capacity = getCapacitySnapshot(next, consultant, asOfDate, false);
        if (capacity.overAllocatedCapacity > 0) {
          warnings.push({
            code: "OVER_ALLOCATION",
            message: `${consultant.name} ${consultant.surname} would be ${capacity.overAllocatedCapacity}% over capacity`,
          });
        }
      }
      return warnings;
    }
    default:
      return [];
  }
}

function confirmationText(action: ResolvedAction, changes: FieldChange[]): string {
  const count = changes.length;
  switch (action.kind) {
    case "createConsultant":
      return `Confirm creation of consultant “${action.consultant.name} ${action.consultant.surname}”`;
    case "updateConsultant":
      return `Confirm ${count} change(s) to consultant ${action.consultantId}`;
    case "createDemand":
      return `Confirm creation of demand “${action.demand.title}”`;
    case "updateDemand":
      return `Confirm ${count} change(s) to demand ${action.demandId}`;
    case "setAllocation":
      return `Confirm ${action.capacity}% allocation of consultant ${action.consultantId} to demand ${action.demandId}`;
    case "removeAllocation":
      return `Confirm removal of consultant ${action.consultantId} from demand ${action.demandId}`;
    case "addAvailabilityBlock":
      return `Confirm unavailable dates ${action.startDate} to ${action.endDate} for consultant ${action.consultantId}`;
    case "removeAvailabilityBlock":
      return `Confirm removal of availability block ${action.availabilityBlockId}`;
  }
}

export async function buildActionPreview(
  proposedAction: ProposedAction,
  data: CapacityDataSet,
  asOfDate: string,
  actorUserId: string,
  expectedPreconditions?: RowVersion[],
): Promise<ActionPreview> {
  if (expectedPreconditions && !preconditionsMatchSnapshot(data, expectedPreconditions)) {
    throw new CapacityActionFailure(
      "STALE_PREVIEW",
      "The underlying data changed before the relative preview could be generated",
    );
  }
  const action = resolveAction(proposedAction, data);
  const after = afterData(data, action);
  const changes = changesFor(data, action);
  const impact = computeActionImpact(data, after, action, asOfDate);
  const warnings = warningsFor(data, action, asOfDate);
  const preconditions = rowVersions(data);
  const dependencyFingerprint = await sha256(preconditions);
  const core = {
    action,
    asOfDate,
    changes,
    impact,
    warnings,
    dependencyFingerprint,
    actorUserId,
  };
  const previewId = await sha256(core);
  return {
    phase: "preview",
    previewId,
    action,
    asOfDate,
    changes,
    impact,
    warnings,
    preconditions,
    dependencyFingerprint,
    requiresConfirmation: true,
    confirmationText: confirmationText(action, changes),
  };
}
