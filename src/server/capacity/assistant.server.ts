import type {
  ActionableCapacityIntent,
  AssistantCandidate,
  AssistantDemandRow,
  AssistantPersonRow,
  AssistantPreview,
  AssistantReadDetails,
  AssistantRequest,
  AssistantResponse,
  CapacityIntent,
  ClarificationField,
  ClarificationSelection,
} from "@/domain/capacity/assistant";
import { clarificationFieldSchema } from "@/domain/capacity/assistant";
import type {
  ActionPreview,
  ActionResult,
  CapacityDataSet,
  CapacitySnapshot,
  ConsultantDto,
  DemandDto,
  MutationResult,
  ProposedAction,
  StaffingSnapshot,
} from "@/domain/capacity/contracts";
import { todayIsoDate } from "@/domain/capacity/rules";
import { executeCapacityAction, type CapacityActionResponse } from "./actions.server";
import type { CapacityRepository } from "./repository";

type Interpreter = (
  message: string,
  currentDate: string,
  signal?: AbortSignal,
) => Promise<CapacityIntent>;

type ConsultantReadRow = { consultant: ConsultantDto; capacity: CapacitySnapshot | null };
type DemandReadRow = { demand: DemandDto; staffing: StaffingSnapshot };

function fullName(consultant: Pick<ConsultantDto, "name" | "surname">): string {
  return `${consultant.name} ${consultant.surname}`;
}

function labelsFor(data: CapacityDataSet): Record<string, string> {
  return Object.fromEntries([
    ...data.consultants.map((consultant) => [consultant.id, fullName(consultant)]),
    ...data.demands.map((demand) => [demand.id, demand.title]),
    ...data.availabilityBlocks.map((block) => [block.id, `${block.startDate} to ${block.endDate}`]),
  ]);
}

function personRow(
  consultant: ConsultantDto,
  capacity: CapacitySnapshot | null,
  warnings: string[] = [],
): AssistantPersonRow {
  return {
    id: consultant.id,
    name: fullName(consultant),
    secondary: `${consultant.level} · ${consultant.role}`,
    skills: consultant.skills,
    availableCapacity: capacity?.availableCapacity ?? null,
    rawFreeCapacity: capacity?.rawFreeCapacity ?? null,
    warnings,
  };
}

function demandRow(demand: DemandDto, staffing: StaffingSnapshot): AssistantDemandRow {
  return {
    id: demand.id,
    title: demand.title,
    client: demand.client,
    status: demand.status,
    requiredCapacity: staffing.requiredCapacity,
    staffedCapacity: staffing.staffedCapacity,
    gapCapacity: staffing.gapCapacity,
  };
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

function readPresentation(
  intent: Extract<CapacityIntent, { type: "read" }>,
  result: unknown,
): { message: string; details: AssistantReadDetails } {
  switch (intent.action.kind) {
    case "listConsultants": {
      const data = result as { consultants: ConsultantReadRow[]; count: number };
      let rows = data.consultants;
      if (intent.presentation === "available_consultants") {
        rows = rows
          .filter((row) => row.capacity?.isAvailable)
          .sort(
            (a, b) => (b.capacity?.availableCapacity ?? 0) - (a.capacity?.availableCapacity ?? 0),
          );
      }
      const onDate = intent.action.onDate ?? null;
      const message =
        intent.presentation === "available_consultants"
          ? rows.length
            ? `${rows.length} ${plural(rows.length, "person", "people")} ${plural(rows.length, "has", "have")} capacity on ${onDate}.`
            : `No active consultants have capacity on ${onDate}.`
          : `Found ${rows.length} ${plural(rows.length, "consultant")}.`;
      return {
        message,
        details: {
          kind: "people",
          onDate,
          rows: rows.map((row) => personRow(row.consultant, row.capacity)),
        },
      };
    }
    case "getConsultant": {
      const data = result as { consultant: ConsultantDto; capacity: CapacitySnapshot | null };
      return {
        message: data.capacity
          ? `${fullName(data.consultant)} has ${data.capacity.availableCapacity}% available capacity on ${data.capacity.onDate}.`
          : `Here are the current details for ${fullName(data.consultant)}.`,
        details: {
          kind: "people",
          onDate: data.capacity?.onDate ?? null,
          rows: [personRow(data.consultant, data.capacity)],
        },
      };
    }
    case "listDemands": {
      const data = result as { demands: DemandReadRow[]; count: number };
      return {
        message: `Found ${data.count} ${plural(data.count, "demand", "demands")}.`,
        details: {
          kind: "demands",
          rows: data.demands.map((row) => demandRow(row.demand, row.staffing)),
        },
      };
    }
    case "getDemand": {
      const data = result as {
        demand: DemandDto;
        staffing: StaffingSnapshot;
        allocations: Array<{ allocationId: string; consultant: ConsultantDto; capacity: number }>;
      };
      const row = demandRow(data.demand, data.staffing);
      return {
        message:
          intent.presentation === "staffing_gap"
            ? row.gapCapacity > 0
              ? `${row.title} still needs ${row.gapCapacity}% capacity.`
              : `${row.title} has no remaining staffing gap.`
            : `${row.title} is ${row.staffedCapacity}% staffed against ${row.requiredCapacity}% required capacity.`,
        details: {
          kind: "demand",
          demand: row,
          allocations: data.allocations.map((allocation) => ({
            id: allocation.allocationId,
            name: fullName(allocation.consultant),
            capacity: allocation.capacity,
          })),
        },
      };
    }
    case "getCapacity": {
      const data = result as { consultant: ConsultantDto; capacity: CapacitySnapshot };
      return {
        message: `${fullName(data.consultant)} has ${data.capacity.availableCapacity}% available capacity on ${data.capacity.onDate}${data.capacity.isUnavailable ? " and is marked unavailable" : ""}.`,
        details: {
          kind: "capacity",
          onDate: data.capacity.onDate,
          person: personRow(data.consultant, data.capacity),
          committedCapacity: data.capacity.committedCapacity,
          pipelineCapacity: data.capacity.pipelineCapacity,
          unavailable: data.capacity.isUnavailable,
        },
      };
    }
    case "findStaffingCandidates": {
      const data = result as {
        demand: DemandDto;
        candidates: Array<{
          consultant: ConsultantDto;
          capacity: CapacitySnapshot;
          skillMatch: { count: number; matched: string[]; missing: string[] };
          warnings: Array<{ message: string }>;
        }>;
      };
      const rows = data.candidates.map((candidate) =>
        personRow(candidate.consultant, candidate.capacity, [
          `${candidate.skillMatch.count}/${data.demand.skills.length} skills matched`,
          ...candidate.warnings.map((warning) => warning.message),
        ]),
      );
      return {
        message: rows.length
          ? `Here are the best staffing candidates for ${data.demand.title} on ${intent.action.onDate}.`
          : `No staffing candidates matched ${data.demand.title}.`,
        details: { kind: "people", onDate: intent.action.onDate, rows },
      };
    }
    case "getTeamOverview": {
      const data = result as {
        team: {
          activeCount: number;
          availableCapacity: number;
          overAllocatedCapacity: number;
        };
        demand: { gapCapacity: number };
        overAllocatedConsultants: ConsultantReadRow[];
        unstaffedDemands: DemandReadRow[];
      };
      const people = data.overAllocatedConsultants.map((row) =>
        personRow(row.consultant, row.capacity),
      );
      const message =
        intent.presentation === "overallocated_consultants"
          ? people.length
            ? `${people.length} ${plural(people.length, "person", "people")} ${plural(people.length, "is", "are")} overallocated on ${intent.action.onDate}.`
            : `No one is overallocated on ${intent.action.onDate}.`
          : `The team has ${data.team.availableCapacity}% available capacity and ${data.demand.gapCapacity}% of open staffing gap on ${intent.action.onDate}.`;
      return {
        message,
        details: {
          kind: "overview",
          onDate: intent.action.onDate,
          activeCount: data.team.activeCount,
          availableCapacity: data.team.availableCapacity,
          overAllocatedCapacity: data.team.overAllocatedCapacity,
          staffingGap: data.demand.gapCapacity,
          people,
          demands: data.unstaffedDemands.map((row) => demandRow(row.demand, row.staffing)),
        },
      };
    }
  }
}

function previewTitle(action: ActionPreview["action"]): string {
  switch (action.kind) {
    case "updateConsultant":
      return "Update consultant";
    case "createDemand":
      return "Create demand";
    case "updateDemand":
      return "Update demand";
    case "setAllocation":
      return action.allocationId ? "Change allocation" : "Create allocation";
    case "removeAllocation":
      return "Remove allocation";
    case "addAvailabilityBlock":
      return "Add unavailable dates";
    case "removeAvailabilityBlock":
      return "Remove unavailable dates";
  }
}

function previewSubject(preview: ActionPreview, labels: Record<string, string>): string {
  const action = preview.action;
  switch (action.kind) {
    case "updateConsultant":
      return labels[action.consultantId] ?? "Consultant";
    case "createDemand":
      return action.demand.title;
    case "updateDemand":
      return labels[action.demandId] ?? "Demand";
    case "setAllocation":
    case "removeAllocation":
      return `${labels[action.consultantId] ?? "Consultant"} → ${labels[action.demandId] ?? "Demand"}`;
    case "addAvailabilityBlock":
      return `${labels[action.consultantId] ?? "Consultant"} · ${action.startDate} to ${action.endDate}`;
    case "removeAvailabilityBlock":
      return labels[action.availabilityBlockId] ?? "Unavailable dates";
  }
}

function sanitizePreview(preview: ActionPreview, data: CapacityDataSet): AssistantPreview {
  const labels = labelsFor(data);
  return {
    previewId: preview.previewId,
    asOfDate: preview.asOfDate,
    title: previewTitle(preview.action),
    subject: previewSubject(preview, labels),
    changes: preview.changes,
    warnings: preview.warnings,
    impact: preview.impact,
    labels,
    requiresConfirmation: true,
  };
}

function unsupportedMessage(
  reason: Extract<CapacityIntent, { type: "unsupported" }>["reason"],
): string {
  switch (reason) {
    case "destructive_action":
      return "I can’t perform destructive consultant or demand deletion.";
    case "missing_information":
      return "I need a little more information before I can form a typed Capacity Hub action.";
    case "outside_capacity_hub":
      return "That request is outside the Capacity Hub actions I can use.";
    case "security_request":
      return "I can’t access credentials, run SQL, use service-role data access, or bypass confirmation.";
  }
}

function errorResponse(
  code: string,
  message: string,
  currentDate: string,
  retryable = false,
): AssistantResponse {
  return {
    ok: false,
    error: { code, message, ...(retryable ? { retryable: true } : {}) },
    currentDate,
  };
}

function actionRequest(intent: ActionableCapacityIntent) {
  return intent.type === "read"
    ? ({ mode: "read", action: intent.action } as const)
    : ({ mode: "preview", action: intent.action, asOfDate: intent.asOfDate } as const);
}

function ambiguous(result: CapacityActionResponse): {
  field: ClarificationField;
  candidates: AssistantCandidate[];
} | null {
  if (result.ok || result.error.code !== "AMBIGUOUS_REFERENCE" || !result.error.field) return null;
  const field = clarificationFieldSchema.safeParse(result.error.field);
  if (!field.success || !result.error.candidates?.length) return null;
  return { field: field.data, candidates: result.error.candidates };
}

function withConsultantId(ref: unknown, candidateId: string) {
  void ref;
  return { consultantId: candidateId } as const;
}

function withDemandId(ref: unknown, candidateId: string) {
  void ref;
  return { demandId: candidateId } as const;
}

export function applyClarificationSelection(
  intent: ActionableCapacityIntent,
  selection: ClarificationSelection,
): ActionableCapacityIntent {
  const action = intent.action;
  let next: typeof action;
  switch (action.kind) {
    case "listConsultants":
    case "getTeamOverview":
      throw new Error("INVALID_CLARIFICATION");
    case "getConsultant":
    case "getCapacity":
      if (selection.field !== "consultant") throw new Error("INVALID_CLARIFICATION");
      next = { ...action, consultant: withConsultantId(action.consultant, selection.candidateId) };
      break;
    case "listDemands":
      if (selection.field !== "owner") throw new Error("INVALID_CLARIFICATION");
      next = { ...action, owner: withConsultantId(action.owner, selection.candidateId) };
      break;
    case "getDemand":
    case "findStaffingCandidates":
      if (selection.field !== "demand") throw new Error("INVALID_CLARIFICATION");
      next = { ...action, demand: withDemandId(action.demand, selection.candidateId) };
      break;
    case "updateConsultant":
      if (selection.field !== "consultant") throw new Error("INVALID_CLARIFICATION");
      next = { ...action, consultant: withConsultantId(action.consultant, selection.candidateId) };
      break;
    case "createDemand":
      if (selection.field !== "demand.owner") throw new Error("INVALID_CLARIFICATION");
      next = {
        ...action,
        demand: {
          ...action.demand,
          owner: withConsultantId(action.demand.owner, selection.candidateId),
        },
      };
      break;
    case "updateDemand":
      if (selection.field === "demand")
        next = { ...action, demand: withDemandId(action.demand, selection.candidateId) };
      else if (selection.field === "patch.owner")
        next = {
          ...action,
          patch: {
            ...action.patch,
            owner: withConsultantId(action.patch.owner, selection.candidateId),
          },
        };
      else throw new Error("INVALID_CLARIFICATION");
      break;
    case "setAllocation":
    case "removeAllocation":
      if (selection.field === "consultant")
        next = {
          ...action,
          consultant: withConsultantId(action.consultant, selection.candidateId),
        };
      else if (selection.field === "demand")
        next = { ...action, demand: withDemandId(action.demand, selection.candidateId) };
      else throw new Error("INVALID_CLARIFICATION");
      break;
    case "addAvailabilityBlock":
      if (selection.field !== "consultant") throw new Error("INVALID_CLARIFICATION");
      next = { ...action, consultant: withConsultantId(action.consultant, selection.candidateId) };
      break;
    case "removeAvailabilityBlock":
      if (selection.field === "block")
        next = { ...action, block: { availabilityBlockId: selection.candidateId } };
      else if (selection.field === "block.consultant" && "consultant" in action.block)
        next = {
          ...action,
          block: {
            ...action.block,
            consultant: withConsultantId(action.block.consultant, selection.candidateId),
          },
        };
      else throw new Error("INVALID_CLARIFICATION");
      break;
  }
  return { ...intent, action: next } as ActionableCapacityIntent;
}

async function presentActionable(
  intent: ActionableCapacityIntent,
  originalIntent: ActionableCapacityIntent,
  selections: ClarificationSelection[],
  result: CapacityActionResponse,
  repository: CapacityRepository,
  currentDate: string,
): Promise<AssistantResponse> {
  const ambiguity = ambiguous(result);
  if (ambiguity) {
    return {
      ok: true,
      kind: "clarification",
      message: ambiguity.field.includes("demand")
        ? "Which demand do you mean?"
        : ambiguity.field === "block"
          ? "Which unavailable period do you mean?"
          : "Which consultant do you mean?",
      field: ambiguity.field,
      candidates: ambiguity.candidates,
      intent: originalIntent,
      selections,
      currentDate,
    };
  }
  if (!result.ok) return errorResponse(result.error.code, result.error.message, currentDate);
  if (intent.type === "read") {
    const presentation = readPresentation(intent, result.data);
    return { ok: true, kind: "read", ...presentation, currentDate };
  }
  const preview = result.data as ActionPreview;
  const data = await repository.load();
  return {
    ok: true,
    kind: "preview",
    message: preview.changes.length
      ? "Review this change before confirming."
      : "This request would not change the current data.",
    action: intent.action,
    preview: sanitizePreview(preview, data),
    currentDate,
  };
}

async function executeIntent(
  intent: ActionableCapacityIntent,
  repository: CapacityRepository,
  actorUserId: string,
): Promise<CapacityActionResponse> {
  return executeCapacityAction(actionRequest(intent), repository, actorUserId);
}

async function clarify(
  originalIntent: ActionableCapacityIntent,
  selections: ClarificationSelection[],
  repository: CapacityRepository,
  actorUserId: string,
  currentDate: string,
): Promise<AssistantResponse> {
  let working = originalIntent;
  const applied: ClarificationSelection[] = [];
  for (const selection of selections) {
    const result = await executeIntent(working, repository, actorUserId);
    const ambiguity = ambiguous(result);
    if (
      !ambiguity ||
      ambiguity.field !== selection.field ||
      !ambiguity.candidates.some((candidate) => candidate.id === selection.candidateId)
    ) {
      return errorResponse(
        "CLARIFICATION_STALE",
        "Those choices changed. Please retry the original request.",
        currentDate,
        true,
      );
    }
    try {
      working = applyClarificationSelection(working, selection);
    } catch {
      return errorResponse("INVALID_CLARIFICATION", "That choice cannot be applied.", currentDate);
    }
    applied.push(selection);
  }
  const result = await executeIntent(working, repository, actorUserId);
  return presentActionable(working, originalIntent, applied, result, repository, currentDate);
}

async function confirm(
  request: Extract<AssistantRequest, { mode: "confirm" }>,
  repository: CapacityRepository,
  actorUserId: string,
  currentDate: string,
): Promise<AssistantResponse> {
  // This is intentionally only a delegation. Phase 2 owns re-resolution,
  // preview regeneration, stale detection, authorization and mutation behavior.
  const result = await executeCapacityAction(
    {
      mode: "confirm",
      confirmed: true,
      action: request.action,
      asOfDate: request.asOfDate,
      previewId: request.previewId,
    },
    repository,
    actorUserId,
  );

  if (result.ok) {
    const mutation = result.data as MutationResult;
    const data = await repository.load();
    return {
      ok: true,
      kind: "executed",
      success: {
        message: mutation.changed
          ? "The Capacity Hub change was applied."
          : "The requested state was already current; nothing changed.",
        result: mutation,
        labels: labelsFor(data),
      },
      currentDate,
    };
  }

  if (
    result.error.code === "STALE_PREVIEW" &&
    "replacementPreview" in result &&
    result.replacementPreview
  ) {
    const data = await repository.load();
    return {
      ok: false,
      error: {
        code: "STALE_PREVIEW",
        message: "Capacity Hub data changed. Review the updated preview before confirming again.",
      },
      replacement: {
        action: request.action,
        preview: sanitizePreview(result.replacementPreview, data),
      },
      currentDate,
    };
  }
  return errorResponse(result.error.code, result.error.message, currentDate);
}

export async function handleCapacityAssistant(
  request: AssistantRequest,
  repository: CapacityRepository,
  actorUserId: string,
  options: { signal?: AbortSignal; currentDate?: string; interpret?: Interpreter } = {},
): Promise<AssistantResponse> {
  const currentDate = options.currentDate ?? todayIsoDate();
  if (request.mode === "confirm") return confirm(request, repository, actorUserId, currentDate);
  if (request.mode === "clarify") {
    return clarify(request.intent, request.selections, repository, actorUserId, currentDate);
  }

  const interpret =
    options.interpret ?? (await import("./assistant-interpreter.server")).interpretCapacityMessage;
  const intent = await interpret(request.message, currentDate, options.signal);
  if (intent.type === "unsupported") {
    return {
      ok: true,
      kind: "unsupported",
      message: unsupportedMessage(intent.reason),
      reason: intent.reason,
      currentDate,
    };
  }
  const result = await executeIntent(intent, repository, actorUserId);
  return presentActionable(intent, intent, [], result, repository, currentDate);
}
