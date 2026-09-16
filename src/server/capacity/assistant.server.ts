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
  ConversationContext,
} from "@/domain/capacity/assistant";
import { clarificationFieldSchema, conversationContextSchema } from "@/domain/capacity/assistant";
import type { PendingClarification } from "@/domain/capacity/assistant-clarification";
import type {
  SemanticConversationOrHelp,
  SemanticOutcome,
} from "@/domain/capacity/assistant-semantic";
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
import { CapacityActionFailure } from "@/domain/capacity/errors";
import { resolveConsultant, resolveDemand } from "@/domain/capacity/resolution";
import { normalizeSkills } from "@/domain/capacity/form-validation";
import { executeCapacityAction, type CapacityActionResponse } from "./actions.server";
import {
  compileSemanticOutcome,
  compileSemanticActionForClarification,
  compileSemanticReadForClarification,
  type SemanticCompilerOptions,
  type SemanticCompilerOutput,
} from "./assistant-compiler.server";
import {
  clearPendingClarification,
  reconcilePendingClarification,
  revalidatePendingClarification,
  retainPendingClarification,
} from "./assistant-clarification.server";
import {
  interpretCapacityMessageV2,
  type CapacityV2InterpreterOptions,
} from "./assistant-interpreter-v2.server";
import type { CapacityRepository } from "./repository";
import { CAPACITY_ASSISTANT_BOUNDS } from "./bounds.server";

type Interpreter = (
  message: string,
  currentDate: string,
  signal?: AbortSignal,
  context?: ConversationContext,
  knownConsultantNames?: string[],
) => Promise<CapacityIntent>;

type V2Interpreter = (
  message: string,
  currentDate: string,
  options?: CapacityV2InterpreterOptions,
) => Promise<SemanticOutcome>;
type V2Compiler = (
  outcome: SemanticOutcome,
  options: SemanticCompilerOptions,
) => SemanticCompilerOutput;

const V2_READ_CUTOVER_UNSUPPORTED_MESSAGE =
  "The Luna V2 read cutover supports read requests only. V1 fallback is not available.";
const V2_READ_CUTOVER_FAILURE_MESSAGE =
  "The Luna V2 read cutover could not compile this read safely. V1 fallback is not available.";
const V2_WRITE_CUTOVER_MESSAGE =
  "Luna V2 write interpretation is not cut over yet. No preview or mutation was created.";
const V2_WRITE_CUTOVER_FAILURE_MESSAGE =
  "The Luna V2 write cutover could not compile this change safely. No preview or mutation was created.";

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

function productHelpAnswer(topic: string): string {
  const answers: Record<string, string> = {
    pipeline: "Pipeline work is tentative and does not reserve committed capacity.",
    confirmed: "Confirmed work is Won demand and reserves capacity.",
    committedCapacity:
      "Committed capacity is the sum of allocations on Won or In Progress demands active on the date.",
    workingCapacity:
      "Working capacity is the consultant's normal percentage, reduced to zero on unavailable days or for archived consultants.",
    freeCapacity:
      "Free capacity is effective working capacity minus committed load; it can be negative when someone is overallocated.",
    overAllocation:
      "Over-allocation is allowed as an intentional exception and produces a warning rather than blocking a write.",
    candidateRanking:
      "Candidates rank by exact skill matches, then deterministic available capacity, then stable name ordering.",
    includePipeline:
      "Include pipeline adds Incoming allocations to the planning scenario without changing committed capacity.",
    rfp: "An RfP is a demand type for a request for proposal and follows the same staffing rules as other demand.",
    assistantScope:
      "The assistant can read Capacity Hub data and preview typed changes. Every write needs explicit confirmation; SQL, deletion, and history are unavailable.",
  };
  return answers[topic] ?? "Capacity Hub help is unavailable for that topic.";
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
      const data = result as {
        consultant: ConsultantDto;
        capacity: CapacitySnapshot;
        activeAllocations?: Array<{
          demand: DemandDto;
          capacity: number;
          classification: "committed" | "pipeline";
        }>;
      };
      const focus = intent.action.focus ?? "free";
      const zeroCapacity = data.capacity.effectiveWorkingCapacity === 0;
      const overAllocated = data.capacity.overAllocatedCapacity > 0;
      const focusedMessage =
        focus === "committed"
          ? `${fullName(data.consultant)} has ${data.capacity.committedCapacity}% committed capacity on ${data.capacity.onDate}.`
          : focus === "pipeline"
            ? `${fullName(data.consultant)} has ${data.capacity.pipelineCapacity}% pipeline capacity on ${data.capacity.onDate}.`
            : focus === "utilization"
              ? zeroCapacity
                ? `${fullName(data.consultant)} has no effective working capacity on ${data.capacity.onDate}; utilization is not defined for that day.`
                : `${fullName(data.consultant)} is ${Math.round((data.capacity.committedCapacity / data.capacity.effectiveWorkingCapacity) * 100)}% utilized on ${data.capacity.onDate}.`
              : focus === "breakdown"
                ? `${fullName(data.consultant)}: ${data.capacity.effectiveWorkingCapacity}% working − ${data.capacity.committedCapacity}% committed = ${data.capacity.rawFreeCapacity}% free.`
                : focus === "allocations"
                  ? data.activeAllocations?.length
                    ? `${fullName(data.consultant)} has ${data.activeAllocations.length} allocation${data.activeAllocations.length === 1 ? "" : "s"} contributing on ${data.capacity.onDate}.`
                    : `${fullName(data.consultant)} has no allocations contributing on ${data.capacity.onDate}.`
                  : zeroCapacity
                    ? `${fullName(data.consultant)} has no effective working capacity on ${data.capacity.onDate}.`
                    : overAllocated
                      ? `${fullName(data.consultant)} has 0% free and is ${data.capacity.overAllocatedCapacity}% overallocated on ${data.capacity.onDate}.`
                      : `${fullName(data.consultant)} has ${data.capacity.availableCapacity}% available capacity on ${data.capacity.onDate}.`;
      return {
        message: `${focusedMessage}${data.capacity.isArchived ? " The consultant is archived." : data.capacity.isUnavailable ? " The consultant is marked unavailable." : ""}`,
        details: {
          kind: "capacity",
          onDate: data.capacity.onDate,
          person: personRow(data.consultant, data.capacity),
          committedCapacity: data.capacity.committedCapacity,
          pipelineCapacity: data.capacity.pipelineCapacity,
          unavailable: data.capacity.isUnavailable,
          archived: data.capacity.isArchived,
          allocations: data.activeAllocations?.map((allocation) => ({
            demand: allocation.demand.title,
            capacity: allocation.capacity,
            classification: allocation.classification,
          })),
        },
      };
    }
    case "getCapacityRange": {
      const data = result as {
        consultant: ConsultantDto;
        range: {
          range: { startDate: string; endDate: string };
          days: CapacitySnapshot[];
          aggregate: {
            averageFreeCapacity: number;
            minimumFreeCapacity: number;
            maximumFreeCapacity: number;
            effectiveWorkingCapacity: number;
            averageCommittedCapacity: number;
            averagePipelineCapacity: number;
            workingDaysConsidered: number;
          };
        };
        allocations: Array<{
          demand: string;
          capacity: number;
          activeDays: string[];
          classification: "committed" | "pipeline";
        }>;
      };
      const aggregate = data.range.aggregate;
      if (!data.range.days.length) {
        return {
          message: `The requested range ${data.range.range.startDate} to ${data.range.range.endDate} contains no Monday–Friday working days. Ask for an exact weekend date for point-day capacity.`,
          details: {
            kind: "rangeCapacity",
            onDateStart: data.range.range.startDate,
            onDateEnd: data.range.range.endDate,
            person: personRow(data.consultant, null),
            days: [],
            aggregate: { averageFree: 0, minimumFree: 0, maximumFree: 0, workingDays: 0 },
          },
        };
      }
      const variation =
        Math.abs(aggregate.minimumFreeCapacity - aggregate.maximumFreeCapacity) >=
        CAPACITY_ASSISTANT_BOUNDS.rangeVariationNoticePoints;
      if (intent.action.focus === "allocations") {
        return {
          message: data.allocations.length
            ? `${fullName(data.consultant)} has ${data.allocations.length} allocation${data.allocations.length === 1 ? "" : "s"} contributing during this range.`
            : `${fullName(data.consultant)} has no contributing allocations during this range.`,
          details: {
            kind: "allocationBreakdown",
            startDate: data.range.range.startDate,
            endDate: data.range.range.endDate,
            allocations: data.allocations,
          },
        };
      }
      const committedValues = data.range.days.map((day) => day.committedCapacity);
      const pipelineValues = data.range.days.map((day) => day.pipelineCapacity);
      const minCommitted = committedValues.length ? Math.min(...committedValues) : 0;
      const maxCommitted = committedValues.length ? Math.max(...committedValues) : 0;
      const minPipeline = pipelineValues.length ? Math.min(...pipelineValues) : 0;
      const maxPipeline = pipelineValues.length ? Math.max(...pipelineValues) : 0;
      const averageEffective = aggregate.effectiveWorkingCapacity;
      const utilization =
        averageEffective > 0
          ? Math.round((aggregate.averageCommittedCapacity / averageEffective) * 100)
          : null;
      const focusMessage =
        intent.action.focus === "committed"
          ? `Committed capacity is ${minCommitted}%–${maxCommitted}% across the range.`
          : intent.action.focus === "pipeline"
            ? `Pipeline capacity is ${minPipeline}%–${maxPipeline}% across the range.`
            : intent.action.focus === "utilization"
              ? utilization === null
                ? `${fullName(data.consultant)} has no effective working capacity across the requested range; utilization is not defined.`
                : `${fullName(data.consultant)} is ${utilization}% utilized on average across the range.`
              : intent.action.focus === "breakdown"
                ? `Breakdown: ${aggregate.effectiveWorkingCapacity}% average working capacity, ${aggregate.averageCommittedCapacity}% committed, and ${aggregate.averagePipelineCapacity}% pipeline.`
                : null;
      return {
        message:
          focusMessage ??
          (variation
            ? `${fullName(data.consultant)} ranges from ${aggregate.minimumFreeCapacity}% to ${aggregate.maximumFreeCapacity}% free between ${data.range.range.startDate} and ${data.range.range.endDate}.`
            : `${fullName(data.consultant)} has ${aggregate.averageFreeCapacity}% free throughout the requested range.`),
        details: {
          kind: "rangeCapacity",
          onDateStart: data.range.range.startDate,
          onDateEnd: data.range.range.endDate,
          person: personRow(data.consultant, data.range.days[0] ?? null),
          days: data.range.days.map((day) => ({
            onDate: day.onDate,
            free: day.rawFreeCapacity,
            overAllocated: day.overAllocatedCapacity,
            committed: day.committedCapacity,
            pipeline: day.pipelineCapacity,
            unavailable: day.isUnavailable,
          })),
          aggregate: {
            averageFree: aggregate.averageFreeCapacity,
            minimumFree: aggregate.minimumFreeCapacity,
            maximumFree: aggregate.maximumFreeCapacity,
            workingDays: aggregate.workingDaysConsidered,
          },
          utilization,
        },
      };
    }
    case "getTeamOverviewRange": {
      const data = result as {
        range: { startDate: string; endDate: string };
        days: Array<{
          onDate: string;
          effectiveWorkingCapacity: number;
          committedCapacity: number;
          pipelineCapacity: number;
          availableCapacity: number;
          overAllocatedCapacity: number;
          unstaffedDemandGap: number;
        }>;
        aggregate: {
          minimumFreeCapacity: number;
          maximumFreeCapacity: number;
          averageEffectiveWorkingCapacity?: number;
          averageCommittedCapacity?: number;
          averagePipelineCapacity?: number;
        };
      };
      if (!data.days.length) {
        return {
          message: `The requested range ${data.range.startDate} to ${data.range.endDate} contains no Monday–Friday working days.`,
          details: {
            kind: "rangeOverview",
            startDate: data.range.startDate,
            endDate: data.range.endDate,
            days: [],
            minimumFree: 0,
            maximumFree: 0,
          },
        };
      }
      const focus = intent.action.focus ?? "free";
      const averageEffective = data.aggregate.averageEffectiveWorkingCapacity ?? 0;
      const averageCommitted = data.aggregate.averageCommittedCapacity ?? 0;
      const averagePipeline = data.aggregate.averagePipelineCapacity ?? 0;
      const message =
        focus === "committed"
          ? `The team has ${averageCommitted}% committed capacity across the requested range.`
          : focus === "pipeline"
            ? `The team has ${averagePipeline}% pipeline capacity across the requested range.`
            : focus === "utilization"
              ? averageEffective > 0
                ? `The team is ${Math.round((averageCommitted / averageEffective) * 100)}% utilized on average across the requested range.`
                : "The team has no effective working capacity across the requested range; utilization is not defined."
              : focus === "breakdown"
                ? `The team averages ${averageEffective}% working capacity, ${averageCommitted}% committed, and ${averagePipeline}% pipeline across the requested range.`
                : `The team has ${data.aggregate.minimumFreeCapacity}% to ${data.aggregate.maximumFreeCapacity}% free across the requested range.`;
      return {
        message,
        details: {
          kind: "rangeOverview",
          startDate: data.range.startDate,
          endDate: data.range.endDate,
          days: data.days.map((day) => ({
            onDate: day.onDate,
            free: day.availableCapacity,
            overAllocated: day.overAllocatedCapacity,
            committed: day.committedCapacity,
            pipeline: day.pipelineCapacity,
            gap: day.unstaffedDemandGap,
          })),
          minimumFree: data.aggregate.minimumFreeCapacity,
          maximumFree: data.aggregate.maximumFreeCapacity,
        },
      };
    }
    case "findAvailabilityWindows": {
      const data = result as {
        windows: Array<{
          consultant: ConsultantDto;
          range: { startDate: string; endDate: string };
          minimumFreeCapacity: number;
          averageFreeCapacity: number;
        }>;
      };
      return {
        message: data.windows.length
          ? `Found ${data.windows.length} qualifying availability window${data.windows.length === 1 ? "" : "s"}.`
          : "No qualifying availability windows were found.",
        details: {
          kind: "availabilityWindows",
          windows: data.windows.map((window) => ({
            consultant: fullName(window.consultant),
            startDate: window.range.startDate,
            endDate: window.range.endDate,
            minimumFree: window.minimumFreeCapacity,
            averageFree: window.averageFreeCapacity,
          })),
        },
      };
    }
    case "findStaffingCandidatesRange": {
      const data = result as {
        demand: DemandDto;
        candidates: Array<{
          consultant: ConsultantDto;
          range: { aggregate: { minimumFreeCapacity: number; averageFreeCapacity: number } };
          skillMatch: { count: number };
          canCoverMinimum: boolean;
        }>;
      };
      return {
        message: data.candidates.length
          ? `Here are the best range-aware candidates for ${data.demand.title}.`
          : `No candidates matched ${data.demand.title} for the full range.`,
        details: {
          kind: "people",
          onDate: null,
          rows: data.candidates.map((candidate) =>
            personRow(
              candidate.consultant,
              {
                onDate: "range",
                includePipeline: false,
                excludedDemandId: null,
                normalWorkingCapacity: candidate.consultant.workingCapacity,
                effectiveWorkingCapacity: candidate.consultant.workingCapacity,
                committedCapacity: 0,
                pipelineCapacity: 0,
                scenarioLoad: 0,
                rawFreeCapacity: candidate.range.aggregate.minimumFreeCapacity,
                availableCapacity: Math.max(candidate.range.aggregate.minimumFreeCapacity, 0),
                overAllocatedCapacity: Math.max(-candidate.range.aggregate.minimumFreeCapacity, 0),
                isArchived: false,
                isUnavailable: false,
                isAvailable: candidate.canCoverMinimum,
                availabilityBlockId: null,
              },
              [
                `${candidate.skillMatch.count}/${data.demand.skills.length} skills matched`,
                `${candidate.range.aggregate.minimumFreeCapacity}% minimum free`,
              ],
            ),
          ),
        },
      };
    }
    case "findSuitableDemands": {
      const data = result as {
        demands: Array<{
          demand: DemandDto;
          staffing: StaffingSnapshot;
          skillMatch: { count: number };
        }>;
      };
      return {
        message: `Found ${data.demands.length} suitable open demand${data.demands.length === 1 ? "" : "s"}.`,
        details: {
          kind: "demands",
          rows: data.demands.map((row) => demandRow(row.demand, row.staffing)),
        },
      };
    }
    case "skillSupplyDemand": {
      const data = result as {
        skills: Array<{ skill: string; consultants: number; demandCount: number }>;
      };
      return {
        message: `Compared ${data.skills.length} exact normalized skill${data.skills.length === 1 ? "" : "s"}.`,
        details: { kind: "skillSupplyDemand", rows: data.skills },
      };
    }
    case "productHelp": {
      const answer = productHelpAnswer(intent.action.topic);
      return { message: answer, details: { kind: "help", topic: intent.action.topic, answer } };
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
    case "createConsultant":
      return "Create consultant";
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
    case "createConsultant":
      return `${action.consultant.name} ${action.consultant.surname}`;
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
    case "multiple_changes":
      return "I found multiple changes. I’ll keep each preview and confirmation separate; send one change at a time for now.";
    case "missing_information":
      return "I need a little more information before I can form a typed Capacity Hub action.";
    case "outside_capacity_hub":
      return "That request is outside the Capacity Hub actions I can use.";
    case "security_request":
      return "I can’t access credentials, run SQL, use service-role data access, or bypass confirmation.";
    case "allocation_date_granularity":
      return "Capacity Hub allocations apply across a demand’s stored date range; date-specific allocation changes are not supported.";
    case "partial_day_availability":
      return "Availability blocks use inclusive calendar dates; partial-day availability is not supported.";
    case "temporary_capacity_schedule":
      return "Working capacity is stored as one current percentage; temporary date-scoped schedules are not supported.";
    case "history_undo_unavailable":
      return "Capacity Hub does not retain assistant history for undo. Review the current state and submit an explicit change instead.";
  }
  return "That request is not supported.";
}

function errorResponse(
  code: string,
  message: string,
  currentDate: string,
  retryable = false,
  context?: ConversationContext,
): AssistantResponse {
  return {
    ok: false,
    error: { code, message, ...(retryable ? { retryable: true } : {}) },
    currentDate,
    ...(context ? { context } : {}),
  };
}

function withPendingClarification(
  response: AssistantResponse,
  pendingClarification: PendingClarification | null,
): AssistantResponse {
  return { ...response, pendingClarification };
}

function pendingClarificationErrorMessage(error: string): string {
  return error === "PENDING_CLARIFICATION_TOO_LARGE"
    ? "Pending clarification state is too large. Please start the request again."
    : "Pending clarification state is invalid. Please start the request again.";
}

function buildConversationContext(
  intent: ActionableCapacityIntent,
  previous: ConversationContext | undefined,
  data: CapacityDataSet,
): ConversationContext {
  const context: ConversationContext = { ...(previous ?? {}) };
  if (intent.type === "relativeWrite") return context;
  const action = intent.action;
  const enterScope = (scope: ConversationContext["scope"]) => {
    const previousScope = context.scope;
    context.scope = scope;
    if (scope !== "consultant") context.lastConsultant = undefined;
    if (scope !== "demand") context.lastDemand = undefined;
    if (scope === "team") context.explainFocus = undefined;
    if (scope === "demand" && previousScope !== "demand") {
      context.lastFocus = undefined;
      context.explainFocus = undefined;
      context.includePipeline = undefined;
    }
    if (scope === "consultant" && previousScope !== "consultant") {
      context.lastFocus = undefined;
      context.explainFocus = undefined;
    }
    if (scope === "team" && previousScope !== "team" && context.lastFocus === "allocations") {
      context.lastFocus = undefined;
    }
  };
  const rememberConsultant = (ref: unknown) => {
    if (!ref) return;
    try {
      const consultant =
        "name" in (ref as object) && String((ref as { name?: string }).name).toLowerCase() === "me"
          ? data.consultants.find((item) => item.isCurrentUser)
          : resolveConsultant(ref as never, data.consultants);
      if (consultant)
        context.lastConsultant = {
          id: consultant.id,
          label: fullName(consultant),
          disambiguator: consultant.email,
        };
    } catch {
      // Ambiguity remains a user-facing clarification, not context authority.
    }
  };
  const rememberDemand = (ref: unknown) => {
    if (!ref) return;
    try {
      const demand = resolveDemand(ref as never, data.demands);
      if (demand)
        context.lastDemand = {
          id: demand.id,
          label: demand.title,
          disambiguator: demand.client || null,
        };
    } catch {
      // Keep the previous context until the user resolves the current ambiguity.
    }
  };
  if (intent.type === "write") {
    switch (action.kind) {
      case "updateConsultant":
        enterScope("consultant");
        rememberConsultant(action.consultant);
        context.lastRange = undefined;
        break;
      case "setAllocation":
      case "removeAllocation":
        enterScope("demand");
        if ("demand" in action) rememberDemand(action.demand);
        context.lastRange = undefined;
        break;
      case "addAvailabilityBlock":
        enterScope("consultant");
        rememberConsultant(action.consultant);
        context.lastRange = undefined;
        break;
      case "updateDemand":
        enterScope("demand");
        rememberDemand(action.demand);
        context.lastRange = undefined;
        break;
      case "createDemand":
        enterScope("demand");
        context.lastRange = undefined;
        break;
      default:
        break;
    }
  } else {
    switch (action.kind) {
      case "getConsultant":
      case "getCapacity":
      case "getCapacityRange":
      case "findSuitableDemands":
        enterScope("consultant");
        rememberConsultant(action.consultant);
        break;
      case "listDemands":
        enterScope("demand");
        break;
      case "getDemand":
      case "findStaffingCandidates":
      case "findStaffingCandidatesRange":
        enterScope("demand");
        rememberDemand(action.demand);
        break;
      case "getTeamOverview":
      case "getTeamOverviewRange":
      case "listConsultants":
      case "skillSupplyDemand":
        enterScope("team");
        break;
      case "findAvailabilityWindows":
        if (action.consultant) {
          enterScope("consultant");
          rememberConsultant(action.consultant);
        } else {
          enterScope("team");
        }
        break;
      default:
        break;
    }
    if ("onDate" in action && action.onDate)
      context.lastRange = { startDate: action.onDate, endDate: action.onDate };
    else if ("onDate" in action) context.lastRange = undefined;
    if ("startDate" in action && "endDate" in action)
      context.lastRange = { startDate: action.startDate, endDate: action.endDate };
    if (
      ["getConsultant", "listConsultants", "listDemands", "getDemand", "productHelp"].includes(
        action.kind,
      ) &&
      !("onDate" in action && action.onDate)
    ) {
      context.lastRange = undefined;
    }
    if ("includePipeline" in action) context.includePipeline = action.includePipeline;
    if (action.kind === "getCapacity" || action.kind === "getCapacityRange") {
      const focus = action.focus ?? "free";
      if (focus === "breakdown") {
        context.explainFocus =
          context.lastFocus === "pipeline"
            ? "pipeline"
            : context.lastFocus === "committed"
              ? "committed"
              : context.lastFocus === "allocations"
                ? "allocations"
                : (context.explainFocus ?? "free");
        context.lastFocus = "breakdown";
      } else {
        context.lastFocus = focus;
      }
    } else if (action.kind === "getConsultant") {
      context.lastFocus = "allocations";
    } else if (action.kind.includes("Staffing")) {
      context.lastFocus = "staffing";
    } else if (action.kind === "findAvailabilityWindows") {
      context.lastFocus = "availability";
    } else if (action.kind === "getTeamOverviewRange") {
      const previousFocus = context.lastFocus;
      context.lastFocus = action.focus ?? "free";
      if (action.focus === "breakdown") {
        context.explainFocus =
          previousFocus === "pipeline"
            ? "pipeline"
            : previousFocus === "committed"
              ? "committed"
              : "free";
      }
    } else if (action.kind === "getTeamOverview") {
      context.lastFocus = "free";
    }
  }
  return context;
}

function actionRequest(
  intent: ActionableCapacityIntent,
  expectedPreconditions?: import("@/domain/capacity/contracts").RowVersion[],
) {
  if (intent.type === "relativeWrite") {
    throw new Error("RELATIVE_INTENT_NOT_COMPILED");
  }
  return intent.type === "read"
    ? ({ mode: "read", action: intent.action } as const)
    : ({
        mode: "preview",
        action: intent.action,
        asOfDate: intent.asOfDate,
        ...(expectedPreconditions ? { expectedPreconditions } : {}),
      } as const);
}

type PreparedIntent = {
  intent: Extract<ActionableCapacityIntent, { type: "read" | "write" }>;
  expectedPreconditions?: import("@/domain/capacity/contracts").RowVersion[];
};

function relativeVersionSignature(
  intent: Extract<ActionableCapacityIntent, { type: "relativeWrite" }>,
  data: CapacityDataSet,
  actorUserId: string,
): string {
  const operation = intent.operation;
  if (
    operation.kind === "adjustConsultantCapacity" ||
    operation.kind === "changeConsultantSkill" ||
    operation.kind === "updateConsultantProfile"
  ) {
    const consultant = resolveConsultant(
      selfConsultantRef(operation.consultant, data, actorUserId) as never,
      data.consultants,
      { activeOnly: true, field: "consultant" },
    );
    return `consultants:${consultant.id}:${consultant.updatedAt}:${rowStateFingerprint(data, "consultants", consultant.id)}`;
  }
  if (operation.kind === "adjustDemandCapacity") {
    const demand = resolveDemand(operation.demand, data.demands, { field: "demand" });
    return `demands:${demand.id}:${demand.updatedAt}:${rowStateFingerprint(data, "demands", demand.id)}`;
  }
  const consultant = resolveConsultant(
    selfConsultantRef(operation.consultant, data, actorUserId) as never,
    data.consultants,
    { activeOnly: true, field: "consultant" },
  );
  const demand = resolveDemand(operation.demand, data.demands, { field: "demand" });
  const allocation = data.allocations.find(
    (item) => item.consultantId === consultant.id && item.demandId === demand.id,
  );
  return `allocations:${allocation?.id ?? "missing"}:${allocation?.updatedAt ?? "missing"}:${allocation ? rowStateFingerprint(data, "allocations", allocation.id) : "missing"}`;
}

function rowStateFingerprint(
  data: CapacityDataSet,
  table: import("@/domain/capacity/contracts").RowVersion["table"],
  id: string,
): string {
  const rows =
    table === "consultants"
      ? data.consultants
      : table === "demands"
        ? data.demands
        : table === "allocations"
          ? data.allocations
          : data.availabilityBlocks;
  const row = rows.find((item) => item.id === id);
  return JSON.stringify(row ?? null);
}

function relativePreconditions(
  intent: Extract<ActionableCapacityIntent, { type: "relativeWrite" }>,
  data: CapacityDataSet,
  actorUserId: string,
): import("@/domain/capacity/contracts").RowVersion[] {
  const operation = intent.operation;
  if (
    operation.kind === "adjustConsultantCapacity" ||
    operation.kind === "changeConsultantSkill" ||
    operation.kind === "updateConsultantProfile"
  ) {
    const consultant = resolveConsultant(
      selfConsultantRef(operation.consultant, data, actorUserId) as never,
      data.consultants,
      { activeOnly: true, field: "consultant" },
    );
    return [
      {
        table: "consultants",
        id: consultant.id,
        updatedAt: consultant.updatedAt,
        stateFingerprint: rowStateFingerprint(data, "consultants", consultant.id),
      },
    ];
  }
  if (operation.kind === "adjustDemandCapacity") {
    const demand = resolveDemand(operation.demand, data.demands, { field: "demand" });
    return [
      {
        table: "demands",
        id: demand.id,
        updatedAt: demand.updatedAt,
        stateFingerprint: rowStateFingerprint(data, "demands", demand.id),
      },
    ];
  }
  const consultant = resolveConsultant(
    selfConsultantRef(operation.consultant, data, actorUserId) as never,
    data.consultants,
    { activeOnly: true, field: "consultant" },
  );
  const demand = resolveDemand(operation.demand, data.demands, { field: "demand" });
  const allocation = data.allocations.find(
    (item) => item.consultantId === consultant.id && item.demandId === demand.id,
  );
  if (!allocation) throw new CapacityActionFailure("NOT_FOUND", "No allocation exists to adjust");
  return [
    {
      table: "allocations",
      id: allocation.id,
      updatedAt: allocation.updatedAt,
      stateFingerprint: rowStateFingerprint(data, "allocations", allocation.id),
    },
  ];
}

async function normalizeIntent(
  intent: ActionableCapacityIntent,
  repository: CapacityRepository,
  actorUserId: string,
): Promise<PreparedIntent> {
  let data = await repository.load();
  if (intent.type !== "relativeWrite")
    return {
      intent: materializeSelfReferences(intent, data, actorUserId) as Extract<
        ActionableCapacityIntent,
        { type: "read" | "write" }
      >,
    };
  const sourceSignature = relativeVersionSignature(intent, data, actorUserId);
  let expectedPreconditions = relativePreconditions(intent, data, actorUserId);
  const latest = await repository.load();
  if (sourceSignature !== relativeVersionSignature(intent, latest, actorUserId)) {
    data = latest;
    expectedPreconditions = relativePreconditions(intent, data, actorUserId);
  }
  const operation = intent.operation;
  const wrap = (action: ProposedAction): PreparedIntent => ({
    intent: {
      type: "write",
      asOfDate: intent.asOfDate,
      action,
    } as Extract<ActionableCapacityIntent, { type: "write" }>,
    expectedPreconditions,
  });
  if (operation.kind === "adjustConsultantCapacity") {
    const consultant = resolveConsultant(
      selfConsultantRef(operation.consultant, data, actorUserId) as never,
      data.consultants,
      {
        activeOnly: true,
        field: "consultant",
      },
    );
    const next = consultant.workingCapacity + operation.delta;
    if (next < 0 || next > 100)
      throw new CapacityActionFailure(
        "VALIDATION_ERROR",
        "Working capacity must remain between 0% and 100%",
        { field: "workingCapacity" },
      );
    return wrap({
      kind: "updateConsultant",
      consultant: { consultantId: consultant.id },
      patch: { workingCapacity: next },
    });
  }
  if (operation.kind === "updateConsultantProfile") {
    const consultant = resolveConsultant(
      selfConsultantRef(operation.consultant, data, actorUserId) as never,
      data.consultants,
      { activeOnly: true, field: "consultant" },
    );
    let skills = consultant.skills;
    if (operation.skill && operation.operation) {
      const normalizedSkill = normalizeSkills([operation.skill])[0];
      const existing = skills.some(
        (skill) => normalizeSkills([skill])[0].toLowerCase() === normalizedSkill.toLowerCase(),
      );
      if (operation.operation === "remove" && !existing)
        throw new CapacityActionFailure("NOT_FOUND", "That skill is not on the consultant");
      if (operation.operation === "add" && !existing) skills = [...skills, normalizedSkill];
      if (operation.operation === "remove")
        skills = skills.filter(
          (skill) => normalizeSkills([skill])[0].toLowerCase() !== normalizedSkill.toLowerCase(),
        );
    }
    return wrap({
      kind: "updateConsultant",
      consultant: { consultantId: consultant.id },
      patch: {
        ...(operation.role ? { role: operation.role } : {}),
        ...(operation.level ? { level: operation.level } : {}),
        skills,
      },
    });
  }
  if (operation.kind === "adjustAllocation") {
    const consultant = resolveConsultant(
      selfConsultantRef(operation.consultant, data, actorUserId) as never,
      data.consultants,
      {
        activeOnly: true,
        field: "consultant",
      },
    );
    const demand = resolveDemand(operation.demand, data.demands, { field: "demand" });
    const allocation = data.allocations.find(
      (item) => item.consultantId === consultant.id && item.demandId === demand.id,
    );
    if (!allocation) throw new CapacityActionFailure("NOT_FOUND", "No allocation exists to adjust");
    const next = allocation.capacity + operation.delta;
    if (next < 5 || next > 100 || next % 5 !== 0)
      throw new CapacityActionFailure(
        "VALIDATION_ERROR",
        "Allocation must remain between 5% and 100% in 5% increments",
        { field: "capacity" },
      );
    return wrap({
      kind: "setAllocation",
      consultant: { consultantId: consultant.id },
      demand: { demandId: demand.id },
      capacity: next,
    });
  }
  if (operation.kind === "adjustDemandCapacity") {
    const demand = resolveDemand(operation.demand, data.demands, { field: "demand" });
    const next = demand.requiredCapacity + operation.delta;
    if (next < 0 || next > 1000)
      throw new CapacityActionFailure(
        "VALIDATION_ERROR",
        "Required capacity must remain between 0% and 1000%",
        { field: "requiredCapacity" },
      );
    return wrap({
      kind: "updateDemand",
      demand: { demandId: demand.id },
      patch: { requiredCapacity: next },
    });
  }
  const consultant = resolveConsultant(
    selfConsultantRef(operation.consultant, data, actorUserId) as never,
    data.consultants,
    {
      activeOnly: true,
      field: "consultant",
    },
  );
  const normalizedSkill = normalizeSkills([operation.skill])[0];
  const existing = consultant.skills.some(
    (skill) => normalizeSkills([skill])[0].toLowerCase() === normalizedSkill.toLowerCase(),
  );
  if (operation.operation === "add" && existing)
    return wrap({
      kind: "updateConsultant",
      consultant: { consultantId: consultant.id },
      patch: { skills: consultant.skills },
    });
  if (operation.operation === "remove" && !existing)
    throw new CapacityActionFailure("NOT_FOUND", "That skill is not on the consultant");
  const skills =
    operation.operation === "add"
      ? [...consultant.skills, normalizedSkill]
      : consultant.skills.filter(
          (skill) => normalizeSkills([skill])[0].toLowerCase() !== normalizedSkill.toLowerCase(),
        );
  return wrap({
    kind: "updateConsultant",
    consultant: { consultantId: consultant.id },
    patch: { skills },
  });
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

function clarificationFromFailure(
  error: CapacityActionFailure,
  intent: ActionableCapacityIntent,
  selections: ClarificationSelection[],
  currentDate: string,
  context?: ConversationContext,
): AssistantResponse | null {
  if (
    error.detail.code !== "AMBIGUOUS_REFERENCE" ||
    !error.detail.field ||
    !error.detail.candidates?.length
  )
    return null;
  const field = clarificationFieldSchema.safeParse(error.detail.field);
  if (!field.success) return null;
  return {
    ok: true,
    kind: "clarification",
    message: field.data.includes("demand")
      ? "Which demand do you mean?"
      : "Which consultant do you mean?",
    field: field.data,
    candidates: error.detail.candidates,
    intent,
    selections,
    currentDate,
    context,
  };
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
  if (intent.type === "relativeWrite") {
    const operation = intent.operation;
    if (
      operation.kind === "adjustConsultantCapacity" ||
      operation.kind === "changeConsultantSkill" ||
      operation.kind === "updateConsultantProfile"
    ) {
      if (selection.field !== "consultant") throw new Error("INVALID_CLARIFICATION");
      return {
        ...intent,
        operation: {
          ...operation,
          consultant: withConsultantId(operation.consultant, selection.candidateId),
        },
      } as ActionableCapacityIntent;
    }
    if (operation.kind === "adjustAllocation") {
      if (selection.field === "consultant")
        return {
          ...intent,
          operation: {
            ...operation,
            consultant: withConsultantId(operation.consultant, selection.candidateId),
          },
        } as ActionableCapacityIntent;
      if (selection.field === "demand")
        return {
          ...intent,
          operation: {
            ...operation,
            demand: withDemandId(operation.demand, selection.candidateId),
          },
        } as ActionableCapacityIntent;
    }
    if (operation.kind === "adjustDemandCapacity") {
      if (selection.field !== "demand") throw new Error("INVALID_CLARIFICATION");
      return {
        ...intent,
        operation: { ...operation, demand: withDemandId(operation.demand, selection.candidateId) },
      } as ActionableCapacityIntent;
    }
    throw new Error("INVALID_CLARIFICATION");
  }
  const action = intent.action;
  let next: typeof action = action;
  switch (action.kind) {
    case "listConsultants":
    case "getTeamOverview":
      throw new Error("INVALID_CLARIFICATION");
    case "getConsultant":
    case "getCapacity":
    case "getCapacityRange":
    case "findAvailabilityWindows":
    case "findSuitableDemands":
      if (selection.field !== "consultant") throw new Error("INVALID_CLARIFICATION");
      next = { ...action, consultant: withConsultantId(action.consultant, selection.candidateId) };
      break;
    case "listDemands":
      if (selection.field !== "owner") throw new Error("INVALID_CLARIFICATION");
      next = { ...action, owner: withConsultantId(action.owner, selection.candidateId) };
      break;
    case "getDemand":
    case "findStaffingCandidates":
    case "findStaffingCandidatesRange":
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
  context?: ConversationContext,
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
      context,
    };
  }
  if (!result.ok) return errorResponse(result.error.code, result.error.message, currentDate);
  if (intent.type === "read") {
    const presentation = readPresentation(intent, result.data);
    const data = await repository.load();
    return {
      ok: true,
      kind: "read",
      ...presentation,
      currentDate,
      context: buildConversationContext(intent, context, data),
    };
  }
  if (intent.type === "relativeWrite")
    return errorResponse(
      "INVALID_INTENT",
      "The relative change could not be compiled",
      currentDate,
    );
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
    context: buildConversationContext(intent, context, data),
  };
}

async function executeIntent(
  intent: ActionableCapacityIntent,
  repository: CapacityRepository,
  actorUserId: string,
): Promise<CapacityActionResponse> {
  const prepared = await normalizeIntent(intent, repository, actorUserId);
  return executeCapacityAction(
    actionRequest(prepared.intent, prepared.expectedPreconditions),
    repository,
    actorUserId,
  );
}

function isSelfRef(ref: unknown): boolean {
  return (
    !!ref &&
    typeof ref === "object" &&
    "name" in ref &&
    typeof ref.name === "string" &&
    /^(i|me|my)$/i.test(ref.name.trim())
  );
}

function currentConsultantId(data: CapacityDataSet, actorUserId: string): string {
  const matches = data.consultants.filter(
    (consultant) => consultant.isCurrentUser && consultant.linkedToUser,
  );
  if (matches.length !== 1) {
    throw new CapacityActionFailure(
      "NOT_FOUND",
      "Your account is not linked to exactly one consultant profile. Create or link your profile first.",
      { field: "consultant" },
    );
  }
  void actorUserId;
  return matches[0].id;
}

function selfConsultantRef(ref: unknown, data: CapacityDataSet, actorUserId: string): unknown {
  return isSelfRef(ref) ? { consultantId: currentConsultantId(data, actorUserId) } : ref;
}

function materializeSelfReferences(
  intent: ActionableCapacityIntent,
  data: CapacityDataSet,
  actorUserId: string,
): ActionableCapacityIntent {
  if (intent.type === "relativeWrite") return intent;
  if (intent.type === "read") {
    const action = intent.action;
    switch (action.kind) {
      case "getConsultant":
      case "getCapacity":
      case "getCapacityRange":
      case "findSuitableDemands":
        return {
          ...intent,
          action: {
            ...action,
            consultant: selfConsultantRef(action.consultant, data, actorUserId),
          },
        } as ActionableCapacityIntent;
      case "listDemands":
        return {
          ...intent,
          action: {
            ...action,
            owner: action.owner ? selfConsultantRef(action.owner, data, actorUserId) : action.owner,
          },
        } as ActionableCapacityIntent;
      case "findAvailabilityWindows":
        return {
          ...intent,
          action: {
            ...action,
            consultant: action.consultant
              ? selfConsultantRef(action.consultant, data, actorUserId)
              : action.consultant,
          },
        } as ActionableCapacityIntent;
      case "findStaffingCandidates":
      case "findStaffingCandidatesRange":
        return intent;
      default:
        return intent;
    }
  }
  const action = intent.action;
  switch (action.kind) {
    case "updateConsultant":
    case "setAllocation":
    case "removeAllocation":
    case "addAvailabilityBlock":
      return {
        ...intent,
        action: { ...action, consultant: selfConsultantRef(action.consultant, data, actorUserId) },
      } as ActionableCapacityIntent;
    case "createDemand":
      return {
        ...intent,
        action: {
          ...action,
          demand: {
            ...action.demand,
            owner: action.demand.owner
              ? selfConsultantRef(action.demand.owner, data, actorUserId)
              : action.demand.owner,
          },
        },
      } as ActionableCapacityIntent;
    case "updateDemand":
      return {
        ...intent,
        action: {
          ...action,
          demand: action.demand,
          patch: {
            ...action.patch,
            owner: action.patch.owner
              ? selfConsultantRef(action.patch.owner, data, actorUserId)
              : action.patch.owner,
          },
        },
      } as ActionableCapacityIntent;
    case "removeAvailabilityBlock":
      if ("consultant" in action.block)
        return {
          ...intent,
          action: {
            ...action,
            block: {
              ...action.block,
              consultant: selfConsultantRef(action.block.consultant, data, actorUserId),
            },
          },
        } as ActionableCapacityIntent;
      return intent;
    default:
      return intent;
  }
}

function validateConversationContext(
  context: ConversationContext | undefined,
  data: CapacityDataSet,
): ConversationContext | undefined {
  if (!context) return undefined;
  const parsed = conversationContextSchema.parse(context);
  const contextBytes = new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
  if (contextBytes > CAPACITY_ASSISTANT_BOUNDS.maxContextBytes) {
    throw new CapacityActionFailure("VALIDATION_ERROR", "Conversation context is too large", {
      field: "context",
    });
  }
  const validated = structuredClone(parsed) as ConversationContext;
  if (validated.lastConsultant) {
    const consultant = data.consultants.find((item) => item.id === validated.lastConsultant!.id);
    if (!consultant) {
      throw new CapacityActionFailure(
        "CONFLICT",
        "Your previous consultant context is no longer available in the current team data. Please choose the person again.",
        { field: "context.lastConsultant" },
      );
    }
    validated.lastConsultant = {
      id: consultant.id,
      label: fullName(consultant),
      disambiguator: consultant.email,
    };
  }
  if (validated.scope === "team" && (validated.lastConsultant || validated.lastDemand)) {
    throw new CapacityActionFailure(
      "CONFLICT",
      "Your previous team context is inconsistent. Please ask the team question again.",
      { field: "context.scope" },
    );
  }
  if (validated.scope === "consultant" && validated.lastDemand) {
    throw new CapacityActionFailure(
      "CONFLICT",
      "Your previous consultant context is inconsistent. Please identify the consultant again.",
      { field: "context.scope" },
    );
  }
  if (validated.scope === "demand" && validated.lastConsultant) {
    throw new CapacityActionFailure(
      "CONFLICT",
      "Your previous demand context is inconsistent. Please identify the demand again.",
      { field: "context.scope" },
    );
  }
  if (validated.lastDemand) {
    const demand = data.demands.find((item) => item.id === validated.lastDemand!.id);
    if (!demand) {
      throw new CapacityActionFailure(
        "CONFLICT",
        "Your previous demand context is no longer available in the current team data. Please choose the demand again.",
        { field: "context.lastDemand" },
      );
    }
    validated.lastDemand = {
      id: demand.id,
      label: demand.title,
      disambiguator: demand.client || null,
    };
  }
  return validated;
}

async function clarify(
  originalIntent: ActionableCapacityIntent,
  selections: ClarificationSelection[],
  repository: CapacityRepository,
  actorUserId: string,
  currentDate: string,
  context?: ConversationContext,
): Promise<AssistantResponse> {
  let working = originalIntent;
  const applied: ClarificationSelection[] = [];
  for (const selection of selections) {
    let result: CapacityActionResponse;
    try {
      result = await executeIntent(working, repository, actorUserId);
    } catch (error) {
      if (error instanceof CapacityActionFailure) {
        const field = clarificationFieldSchema.safeParse(error.detail.field);
        if (
          error.detail.code === "AMBIGUOUS_REFERENCE" &&
          field.success &&
          field.data === selection.field &&
          error.detail.candidates?.some((candidate) => candidate.id === selection.candidateId)
        ) {
          try {
            working = applyClarificationSelection(working, selection);
            applied.push(selection);
            continue;
          } catch {
            return errorResponse(
              "INVALID_CLARIFICATION",
              "That choice cannot be applied.",
              currentDate,
            );
          }
        }
        const clarification = clarificationFromFailure(
          error,
          originalIntent,
          applied,
          currentDate,
          context,
        );
        if (clarification) return clarification;
        return errorResponse(error.detail.code, error.detail.message, currentDate);
      }
      throw error;
    }
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
  let prepared: PreparedIntent;
  let result: CapacityActionResponse;
  try {
    prepared = await normalizeIntent(working, repository, actorUserId);
    result = await executeCapacityAction(
      actionRequest(prepared.intent, prepared.expectedPreconditions),
      repository,
      actorUserId,
    );
  } catch (error) {
    if (error instanceof CapacityActionFailure) {
      const clarification = clarificationFromFailure(
        error,
        originalIntent,
        applied,
        currentDate,
        context,
      );
      if (clarification) return clarification;
      return errorResponse(error.detail.code, error.detail.message, currentDate);
    }
    throw error;
  }
  return presentActionable(
    prepared.intent,
    originalIntent,
    applied,
    result,
    repository,
    currentDate,
    context,
  );
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

function currentUserConsultantIdForV2(data: CapacityDataSet): string {
  const matches = data.consultants.filter(
    (consultant) => consultant.isCurrentUser && consultant.linkedToUser,
  );
  // An empty selector keeps non-self reads available while causing the
  // compiler's self resolver to reject an unlinked or inconsistent profile.
  return matches.length === 1 ? matches[0].id : "";
}

function conversationMessage(
  topic: SemanticConversationOrHelp["topic"],
  pendingClarification: PendingClarification | null,
): string {
  switch (topic) {
    case "greeting":
      return "Hello. I can answer Capacity Hub questions and preview typed staffing changes.";
    case "thanks":
      return "You’re welcome.";
    case "howToUse":
      return "Ask about consultants, demands, capacity, availability, or staffing candidates. Reads are immediate; every write is previewed and needs explicit confirmation.";
    case "clarification":
      return pendingClarification
        ? `The clarification is still open. ${pendingClarification.question} Outstanding fields: ${pendingClarification.missing.join(", ")}.`
        : "There is no outstanding clarification. Ask a new Capacity Hub question whenever you’re ready.";
    default:
      return productHelpAnswer(topic);
  }
}

function routeSemanticNonReadOutcome(
  outcome: SemanticOutcome,
  pendingClarification: PendingClarification | null,
  currentDate: string,
  context: ConversationContext | undefined,
  reconciledPending: PendingClarification | null,
  allowWrites: boolean,
): AssistantResponse | null {
  if (outcome.type === "clarification") {
    return withPendingClarification(
      {
        ok: true,
        kind: "semantic_clarification",
        message: outcome.question,
        currentDate,
        context,
      },
      reconciledPending,
    );
  }
  if (outcome.type === "conversation_or_help") {
    return withPendingClarification(
      {
        ok: true,
        kind: "conversation_or_help",
        topic: outcome.topic,
        message: conversationMessage(outcome.topic, pendingClarification),
        currentDate,
        context,
      },
      reconciledPending,
    );
  }
  if (outcome.type === "unsupported") {
    return withPendingClarification(
      {
        ok: true,
        kind: "unsupported",
        message: unsupportedMessage(outcome.reason),
        reason: outcome.reason,
        currentDate,
        context,
      },
      reconciledPending,
    );
  }
  if (outcome.type === "multiple_changes") {
    return withPendingClarification(
      {
        ok: true,
        kind: "multiple_changes",
        changeCount: outcome.changeCount,
        message: `I found ${outcome.changeCount} changes. Please send one change at a time; no preview or mutation was created.`,
        currentDate,
        context,
      },
      reconciledPending,
    );
  }
  if (outcome.type === "write" || outcome.type === "relativeWrite") {
    if (allowWrites) return null;
    return withPendingClarification(
      errorResponse(
        "V2_WRITE_CUTOVER_NOT_READY",
        V2_WRITE_CUTOVER_MESSAGE,
        currentDate,
        false,
        context,
      ),
      reconciledPending,
    );
  }
  return null;
}

async function handleV2Cutover(
  request: Extract<AssistantRequest, { mode: "interpret" }>,
  repository: CapacityRepository,
  actorUserId: string,
  currentDate: string,
  currentData: CapacityDataSet,
  validatedContext: ConversationContext | undefined,
  pendingClarification: PendingClarification | null,
  finish: (response: AssistantResponse) => AssistantResponse,
  options: {
    signal?: AbortSignal;
    interpretV2?: V2Interpreter;
    compileV2?: V2Compiler;
    allowWrites?: boolean;
  },
): Promise<AssistantResponse> {
  const interpretV2 = options.interpretV2 ?? interpretCapacityMessageV2;
  const outcome = await interpretV2(request.message, currentDate, {
    context: validatedContext,
    pendingClarification: pendingClarification ?? undefined,
    signal: options.signal,
  });

  const reconciled = reconcilePendingClarification(pendingClarification, outcome);
  if (!reconciled.ok) {
    return withPendingClarification(
      errorResponse(
        reconciled.error,
        pendingClarificationErrorMessage(reconciled.error),
        currentDate,
      ),
      null,
    );
  }
  const nonReadResponse = routeSemanticNonReadOutcome(
    outcome,
    pendingClarification,
    currentDate,
    validatedContext,
    reconciled.pending,
    options.allowWrites === true,
  );
  if (nonReadResponse) return nonReadResponse;

  const compilerOptions: SemanticCompilerOptions = {
    data: currentData,
    currentUserConsultantId: currentUserConsultantIdForV2(currentData),
    currentDate,
    context: validatedContext,
  };
  const compileV2 = options.compileV2 ?? compileSemanticOutcome;
  let intent: ActionableCapacityIntent;
  try {
    const compiled = compileV2(outcome, compilerOptions);
    if (compiled.type === "unsupported") {
      return finish({
        ok: true,
        kind: "unsupported",
        message: unsupportedMessage(compiled.reason),
        reason: compiled.reason,
        currentDate,
        context: validatedContext,
      });
    }
    if (
      compiled.type === "clarification" ||
      compiled.type === "multiple_changes" ||
      compiled.type === "conversation_or_help"
    ) {
      return finish(
        errorResponse(
          "V2_READ_CUTOVER_UNSUPPORTED",
          V2_READ_CUTOVER_UNSUPPORTED_MESSAGE,
          currentDate,
          false,
          validatedContext,
        ),
      );
    }
    if (compiled.type !== "read" && options.allowWrites !== true) {
      return finish(
        errorResponse(
          "V2_WRITE_CUTOVER_NOT_READY",
          V2_WRITE_CUTOVER_MESSAGE,
          currentDate,
          false,
          validatedContext,
        ),
      );
    }
    intent = compiled;
  } catch (error) {
    if (error instanceof CapacityActionFailure && error.detail.code === "AMBIGUOUS_REFERENCE") {
      try {
        const clarificationIntent =
          outcome.type === "read"
            ? compileSemanticReadForClarification(outcome, compilerOptions)
            : compileSemanticActionForClarification(outcome, compilerOptions);
        const clarification = clarificationFromFailure(
          error,
          clarificationIntent,
          [],
          currentDate,
          validatedContext,
        );
        if (clarification) return finish(clarification);
      } catch {
        // Fall through to the safe cutover error if the clarification shape
        // cannot be constructed from the same authoritative snapshot.
      }
    }
    const isWriteCutover =
      options.allowWrites === true &&
      (outcome.type === "write" || outcome.type === "relativeWrite");
    return finish(
      errorResponse(
        isWriteCutover ? "V2_WRITE_CUTOVER_COMPILE_FAILED" : "V2_READ_CUTOVER_COMPILE_FAILED",
        isWriteCutover ? V2_WRITE_CUTOVER_FAILURE_MESSAGE : V2_READ_CUTOVER_FAILURE_MESSAGE,
        currentDate,
        true,
        validatedContext,
      ),
    );
  }

  let preparedIntent: PreparedIntent;
  try {
    preparedIntent = await normalizeIntent(intent, repository, actorUserId);
  } catch (error) {
    if (error instanceof CapacityActionFailure) {
      const clarification = clarificationFromFailure(
        error,
        intent,
        [],
        currentDate,
        validatedContext,
      );
      if (clarification) return finish(clarification);
    }
    const writeFailure =
      options.allowWrites === true && (intent.type === "write" || intent.type === "relativeWrite");
    return finish(
      errorResponse(
        writeFailure ? "V2_WRITE_CUTOVER_COMPILE_FAILED" : "V2_READ_CUTOVER_COMPILE_FAILED",
        writeFailure ? V2_WRITE_CUTOVER_FAILURE_MESSAGE : V2_READ_CUTOVER_FAILURE_MESSAGE,
        currentDate,
        true,
        validatedContext,
      ),
    );
  }
  const result = await executeCapacityAction(
    actionRequest(preparedIntent.intent, preparedIntent.expectedPreconditions),
    repository,
    actorUserId,
  );
  return finish(
    await presentActionable(
      preparedIntent.intent,
      intent,
      [],
      result,
      repository,
      currentDate,
      validatedContext,
    ),
  );
}

export async function handleCapacityAssistant(
  request: AssistantRequest,
  repository: CapacityRepository,
  actorUserId: string,
  options: {
    signal?: AbortSignal;
    currentDate?: string;
    interpret?: Interpreter;
    semanticOutcome?: SemanticOutcome;
    useV2Reads?: boolean;
    useV2Writes?: boolean;
    interpretV2?: V2Interpreter;
    compileV2?: V2Compiler;
  } = {},
): Promise<AssistantResponse> {
  const currentDate = options.currentDate ?? todayIsoDate();
  if (request.mode === "confirm") {
    return confirm(request, repository, actorUserId, currentDate);
  }
  const pendingState = revalidatePendingClarification(request.pendingClarification);
  if (!pendingState.ok) {
    return withPendingClarification(
      errorResponse(
        pendingState.error,
        pendingClarificationErrorMessage(pendingState.error),
        currentDate,
      ),
      null,
    );
  }
  const pendingClarification = pendingState.pending;
  const finish = (response: AssistantResponse) => {
    const nextPending =
      response.ok && response.kind === "clarification"
        ? retainPendingClarification(pendingClarification)
        : clearPendingClarification();
    return withPendingClarification(response, nextPending);
  };
  const currentData = await repository.load();
  let validatedContext: ConversationContext | undefined;
  try {
    validatedContext = validateConversationContext(request.context, currentData);
  } catch (error) {
    if (error instanceof CapacityActionFailure) {
      return finish(
        errorResponse("CONTEXT_INVALIDATED", error.detail.message, currentDate, true, {}),
      );
    }
    throw error;
  }
  if ((options.useV2Reads || options.useV2Writes) && request.mode === "interpret") {
    return handleV2Cutover(
      request,
      repository,
      actorUserId,
      currentDate,
      currentData,
      validatedContext,
      pendingClarification,
      finish,
      { ...options, allowWrites: options.useV2Writes === true },
    );
  }
  if (options.semanticOutcome) {
    const reconciled = reconcilePendingClarification(pendingClarification, options.semanticOutcome);
    if (!reconciled.ok) {
      return withPendingClarification(
        errorResponse(
          reconciled.error,
          pendingClarificationErrorMessage(reconciled.error),
          currentDate,
        ),
        null,
      );
    }
    const nonReadResponse = routeSemanticNonReadOutcome(
      options.semanticOutcome,
      pendingClarification,
      currentDate,
      validatedContext,
      reconciled.pending,
      options.useV2Writes === true,
    );
    if (nonReadResponse) return nonReadResponse;
    return withPendingClarification(
      errorResponse(
        "SEMANTIC_OUTCOME_NOT_ROUTED",
        "This semantic assistant outcome is not routed by the current handler yet.",
        currentDate,
      ),
      reconciled.pending,
    );
  }
  if (request.mode === "clarify") {
    return finish(
      await clarify(
        request.intent,
        request.selections,
        repository,
        actorUserId,
        currentDate,
        validatedContext,
      ),
    );
  }

  const interpret =
    options.interpret ?? (await import("./assistant-interpreter.server")).interpretCapacityMessage;
  const intent = await interpret(
    request.message,
    currentDate,
    options.signal,
    validatedContext,
    currentData.consultants.map((consultant) => fullName(consultant)),
  );
  if (intent.type === "unsupported") {
    return finish({
      ok: true,
      kind: "unsupported",
      message: unsupportedMessage(intent.reason),
      reason: intent.reason,
      currentDate,
      context: validatedContext,
    });
  }
  let preparedIntent: PreparedIntent;
  try {
    preparedIntent = await normalizeIntent(intent, repository, actorUserId);
  } catch (error) {
    if (error instanceof CapacityActionFailure) {
      const clarification = clarificationFromFailure(
        error,
        intent,
        [],
        currentDate,
        validatedContext,
      );
      if (clarification) return finish(clarification);
      return finish(errorResponse(error.detail.code, error.detail.message, currentDate));
    }
    throw error;
  }
  const result = await executeCapacityAction(
    actionRequest(preparedIntent.intent, preparedIntent.expectedPreconditions),
    repository,
    actorUserId,
  );
  return finish(
    await presentActionable(
      preparedIntent.intent,
      intent,
      [],
      result,
      repository,
      currentDate,
      validatedContext,
    ),
  );
}
