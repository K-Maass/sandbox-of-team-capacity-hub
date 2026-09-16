import { z } from "zod";

import {
  actionableCapacityIntentSchema,
  capacityIntentSchema,
  conversationContextSchema,
  type ActionableCapacityIntent,
  type CapacityIntent,
  type ConversationContext,
} from "@/domain/capacity/assistant";
import {
  semanticOutcomeSchema,
  type SemanticOutcome,
  type SemanticConsultantRef,
  type SemanticDemandRef,
  type SemanticPointTimeRef,
  type SemanticRangeRef,
  type SemanticReadAction,
  type SemanticRelativeWriteOperation,
  type SemanticWriteAction,
  type SemanticClarification,
  type SemanticConversationOrHelp,
  type SemanticMultipleChanges,
} from "@/domain/capacity/assistant-semantic";
import { calendarDateSchema } from "@/domain/capacity/assistant-context";
import type {
  ActionError,
  CapacityDataSet,
  ConsultantRef,
  DemandRef,
  ProposedAction,
  ReadAction,
} from "@/domain/capacity/contracts";
import { CapacityActionFailure } from "@/domain/capacity/errors";
import { resolveConsultant, resolveDemand } from "@/domain/capacity/resolution";
import { proposedActionSchema, readActionSchema } from "@/domain/capacity/validation";
import { CAPACITY_ASSISTANT_BOUNDS } from "./bounds.server";

export type SemanticCompilerOptions = {
  data: CapacityDataSet;
  /** Authenticated/RLS-derived selector; supplied by the server boundary, never by Luna or the client. */
  currentUserConsultantId: string;
  currentDate: string;
  context?: ConversationContext;
};

/** Non-executable semantic outcomes intentionally remain separate from intents. */
export type SemanticNonActionResult =
  SemanticClarification | SemanticMultipleChanges | SemanticConversationOrHelp;

export type SemanticCompilerOutput =
  | ActionableCapacityIntent
  | Extract<CapacityIntent, { type: "unsupported" }>
  | SemanticNonActionResult;

export type SemanticCompilerResult =
  { ok: true; output: SemanticCompilerOutput } | { ok: false; error: ActionError };

type ValidatedOptions = SemanticCompilerOptions & {
  context?: ConversationContext;
};

type CompilerPresentation =
  "default" | "available_consultants" | "staffing_gap" | "overallocated_consultants";

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayNumber(value: string): number {
  return new Date(`${value}T00:00:00Z`).getTime();
}

function dayDistance(first: string, second: string): number {
  return Math.abs(dayNumber(first) - dayNumber(second)) / 86_400_000;
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.round((dayNumber(endDate) - dayNumber(startDate)) / 86_400_000) + 1;
}

function mondayOfWeek(value: string): string {
  const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return addDays(value, -daysFromMonday);
}

function assertPointDate(value: string, currentDate: string, field: string): string {
  calendarDateSchema.parse(value);
  if (dayDistance(value, currentDate) > CAPACITY_ASSISTANT_BOUNDS.maxDateHorizonDays) {
    throw new CapacityActionFailure(
      "VALIDATION_ERROR",
      "The requested date is outside the Capacity Hub planning horizon",
      { field },
    );
  }
  return value;
}

function assertRange(startDate: string, endDate: string, currentDate: string, field: string) {
  if (endDate < startDate) {
    throw new CapacityActionFailure("VALIDATION_ERROR", "End date cannot be before start date", {
      field: `${field}.endDate`,
    });
  }
  assertPointDate(startDate, currentDate, `${field}.startDate`);
  assertPointDate(endDate, currentDate, `${field}.endDate`);
  if (daysBetween(startDate, endDate) > CAPACITY_ASSISTANT_BOUNDS.maxDateHorizonDays) {
    throw new CapacityActionFailure("VALIDATION_ERROR", "The requested range is too large", {
      field,
    });
  }

  let workingDays = 0;
  for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
    const weekday = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) workingDays += 1;
  }
  if (workingDays > CAPACITY_ASSISTANT_BOUNDS.maxWorkingDays) {
    throw new CapacityActionFailure(
      "VALIDATION_ERROR",
      "The requested range has too many working days",
      {
        field,
      },
    );
  }
  return { startDate, endDate };
}

function validateOptions(options: SemanticCompilerOptions): ValidatedOptions {
  const currentDate = calendarDateSchema.safeParse(options.currentDate);
  if (!currentDate.success) {
    throw new CapacityActionFailure("VALIDATION_ERROR", "Current date is invalid", {
      field: "currentDate",
    });
  }
  if (!options.context) return { ...options, currentDate: currentDate.data };

  const parsed = conversationContextSchema.safeParse(options.context);
  if (!parsed.success) {
    throw new CapacityActionFailure("VALIDATION_ERROR", "Conversation context is invalid", {
      field: "context",
    });
  }
  const context = parsed.data;
  if (
    context.lastConsultant &&
    !options.data.consultants.some((item) => item.id === context.lastConsultant!.id)
  ) {
    throw new CapacityActionFailure(
      "CONFLICT",
      "The previous consultant context is no longer available in the current team data",
      { field: "context.lastConsultant" },
    );
  }
  if (
    context.lastDemand &&
    !options.data.demands.some((item) => item.id === context.lastDemand!.id)
  ) {
    throw new CapacityActionFailure(
      "CONFLICT",
      "The previous demand context is no longer available in the current team data",
      { field: "context.lastDemand" },
    );
  }
  if (context.scope === "team" && (context.lastConsultant || context.lastDemand)) {
    throw new CapacityActionFailure("CONFLICT", "The previous team context is inconsistent", {
      field: "context.scope",
    });
  }
  if (context.scope === "consultant" && context.lastDemand) {
    throw new CapacityActionFailure("CONFLICT", "The previous consultant context is inconsistent", {
      field: "context.scope",
    });
  }
  if (context.scope === "demand" && context.lastConsultant) {
    throw new CapacityActionFailure("CONFLICT", "The previous demand context is inconsistent", {
      field: "context.scope",
    });
  }
  return { ...options, currentDate: currentDate.data, context };
}

function currentConsultantId(options: ValidatedOptions): string {
  const consultant = options.data.consultants.find(
    (item) => item.id === options.currentUserConsultantId,
  );
  if (!consultant || !consultant.linkedToUser || consultant.archivedAt !== null) {
    throw new CapacityActionFailure(
      "NOT_FOUND",
      "Your authenticated account is not linked to an active consultant profile",
      { field: "consultant" },
    );
  }
  return consultant.id;
}

function consultantRef(
  ref: SemanticConsultantRef,
  options: ValidatedOptions,
  field: string,
  preserveAmbiguousName = false,
): ConsultantRef {
  if (ref.kind === "self") return { consultantId: currentConsultantId(options) };
  if (ref.kind === "current_context") {
    if (!options.context?.lastConsultant) {
      throw new CapacityActionFailure(
        "NOT_FOUND",
        "No consultant is available in the current context",
        {
          field,
        },
      );
    }
    const consultant = options.data.consultants.find(
      (item) => item.id === options.context!.lastConsultant!.id,
    );
    if (!consultant) {
      throw new CapacityActionFailure(
        "CONFLICT",
        "The current consultant context is no longer valid",
        {
          field,
        },
      );
    }
    return { consultantId: consultant.id };
  }
  let consultant;
  try {
    consultant = resolveConsultant({ name: ref.name }, options.data.consultants, { field });
  } catch (error) {
    if (
      preserveAmbiguousName &&
      error instanceof CapacityActionFailure &&
      error.detail.code === "AMBIGUOUS_REFERENCE"
    ) {
      return { name: ref.name };
    }
    throw error;
  }
  return { consultantId: consultant.id };
}

function demandRef(
  ref: SemanticDemandRef,
  options: ValidatedOptions,
  field: string,
  preserveAmbiguousName = false,
): DemandRef {
  if (ref.kind === "current_context") {
    if (!options.context?.lastDemand) {
      throw new CapacityActionFailure(
        "NOT_FOUND",
        "No demand is available in the current context",
        {
          field,
        },
      );
    }
    const demand = options.data.demands.find((item) => item.id === options.context!.lastDemand!.id);
    if (!demand) {
      throw new CapacityActionFailure("CONFLICT", "The current demand context is no longer valid", {
        field,
      });
    }
    return { demandId: demand.id };
  }
  let demand;
  try {
    demand = resolveDemand({ title: ref.name }, options.data.demands, { field });
  } catch (error) {
    if (
      preserveAmbiguousName &&
      error instanceof CapacityActionFailure &&
      error.detail.code === "AMBIGUOUS_REFERENCE"
    ) {
      return { title: ref.name };
    }
    throw error;
  }
  return { demandId: demand.id };
}

function resolvePoint(ref: SemanticPointTimeRef, options: ValidatedOptions, field: string): string {
  let value: string;
  switch (ref.kind) {
    case "date":
      value = ref.date;
      break;
    case "days_from_today":
      value = addDays(options.currentDate, ref.days);
      break;
    case "week_offset":
      value = addDays(mondayOfWeek(options.currentDate), ref.weeks * 7);
      break;
    case "relative_weekday": {
      const weekdays = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      const today = new Date(`${options.currentDate}T00:00:00Z`).getUTCDay();
      const target = weekdays.indexOf(ref.weekday);
      let offset = (target - today + 7) % 7;
      if (offset === 0) offset = 7;
      value = addDays(options.currentDate, offset + ref.weekOffset * 7);
      break;
    }
    case "current_context":
      if (!options.context?.lastRange) {
        throw new CapacityActionFailure(
          "NOT_FOUND",
          "No date range is available in the current context",
          {
            field,
          },
        );
      }
      value = options.context.lastRange.startDate;
      break;
  }
  return assertPointDate(value, options.currentDate, field);
}

function resolveRange(
  ref: SemanticRangeRef,
  options: ValidatedOptions,
  field: string,
): { startDate: string; endDate: string } {
  let startDate: string;
  let endDate: string;
  switch (ref.kind) {
    case "range":
      ({ startDate, endDate } = ref);
      break;
    case "current_context":
      if (!options.context?.lastRange) {
        throw new CapacityActionFailure(
          "NOT_FOUND",
          "No date range is available in the current context",
          {
            field,
          },
        );
      }
      ({ startDate, endDate } = options.context.lastRange);
      break;
    case "week_offset":
      startDate = addDays(mondayOfWeek(options.currentDate), ref.weeks * 7);
      endDate = addDays(startDate, 4);
      break;
    case "week_range":
      startDate = addDays(mondayOfWeek(options.currentDate), ref.startWeekOffset * 7);
      endDate = addDays(startDate, (ref.durationWeeks - 1) * 7 + 4);
      break;
  }
  return assertRange(startDate, endDate, options.currentDate, field);
}

function pointOrNull(
  value: SemanticPointTimeRef | null | undefined,
  options: ValidatedOptions,
  field: string,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return resolvePoint(value, options, field);
}

function rangeActionDates(
  ref: SemanticRangeRef,
  options: ValidatedOptions,
  field: string,
): { startDate: string; endDate: string } {
  return resolveRange(ref, options, field);
}

function readIntent(
  action: ReadAction,
  presentation: CompilerPresentation,
): ActionableCapacityIntent {
  return actionableCapacityIntentSchema.parse({ type: "read", action, presentation });
}

function compileRead(
  action: SemanticReadAction,
  options: ValidatedOptions,
  presentation: CompilerPresentation,
  preserveAmbiguousNames = false,
): ActionableCapacityIntent {
  let read: ReadAction;
  switch (action.kind) {
    case "listConsultants":
      read = readActionSchema.parse({
        kind: action.kind,
        status: action.status,
        role: action.role,
        level: action.level,
        skills: action.skills,
        onDate: action.onDate ? resolvePoint(action.onDate, options, "action.onDate") : undefined,
        includePipeline: action.includePipeline,
      });
      return readIntent(
        read,
        action.capacityFilter === "available" ? "available_consultants" : presentation,
      );
    case "getConsultant":
      read = readActionSchema.parse({
        kind: action.kind,
        consultant: consultantRef(action.consultant, options, "consultant", preserveAmbiguousNames),
        onDate: action.onDate ? resolvePoint(action.onDate, options, "action.onDate") : undefined,
        includePipeline: action.includePipeline,
      });
      return readIntent(read, presentation);
    case "listDemands":
      read = readActionSchema.parse({
        kind: action.kind,
        statuses: action.statuses,
        types: action.types,
        owner: action.owner
          ? consultantRef(action.owner, options, "owner", preserveAmbiguousNames)
          : undefined,
        activeOn: action.activeOn
          ? resolvePoint(action.activeOn, options, "action.activeOn")
          : undefined,
        skills: action.skills,
        includeClosed: action.includeClosed,
      });
      return readIntent(read, presentation);
    case "getDemand":
      read = readActionSchema.parse({
        kind: action.kind,
        demand: demandRef(action.demand, options, "demand", preserveAmbiguousNames),
        onDate: action.onDate ? resolvePoint(action.onDate, options, "action.onDate") : undefined,
      });
      return readIntent(read, action.focus === "staffing_gap" ? "staffing_gap" : presentation);
    case "getCapacity":
      read = readActionSchema.parse({
        kind: action.kind,
        consultant: consultantRef(action.consultant, options, "consultant", preserveAmbiguousNames),
        onDate: resolvePoint(action.onDate, options, "action.onDate"),
        includePipeline: action.includePipeline,
        focus: action.focus,
      });
      return readIntent(read, presentation);
    case "getCapacityRange": {
      const range = rangeActionDates(action.range, options, "action.range");
      read = readActionSchema.parse({
        kind: action.kind,
        consultant: consultantRef(action.consultant, options, "consultant", preserveAmbiguousNames),
        ...range,
        includePipeline: action.includePipeline,
        focus: action.focus,
      });
      return readIntent(read, presentation);
    }
    case "getTeamOverviewRange": {
      const range = rangeActionDates(action.range, options, "action.range");
      read = readActionSchema.parse({
        kind: action.kind,
        ...range,
        includePipeline: action.includePipeline,
        role: action.role,
        level: action.level,
        focus: action.focus,
      });
      return readIntent(read, presentation);
    }
    case "findAvailabilityWindows": {
      const range = rangeActionDates(action.range, options, "action.range");
      read = readActionSchema.parse({
        kind: action.kind,
        consultant: action.consultant
          ? consultantRef(action.consultant, options, "consultant", preserveAmbiguousNames)
          : undefined,
        ...range,
        minimumFreeCapacity: action.minimumFreeCapacity,
        minimumWorkingDays: action.minimumWorkingDays,
        includePipeline: action.includePipeline,
      });
      return readIntent(read, presentation);
    }
    case "findStaffingCandidatesRange": {
      const range = rangeActionDates(action.range, options, "action.range");
      read = readActionSchema.parse({
        kind: action.kind,
        demand: demandRef(action.demand, options, "demand", preserveAmbiguousNames),
        ...range,
        includePipeline: action.includePipeline,
        minimumSkillMatches: action.minimumSkillMatches,
        limit: action.limit,
      });
      return readIntent(read, presentation);
    }
    case "findSuitableDemands": {
      const range = rangeActionDates(action.range, options, "action.range");
      read = readActionSchema.parse({
        kind: action.kind,
        consultant: consultantRef(action.consultant, options, "consultant", preserveAmbiguousNames),
        ...range,
        includePipeline: action.includePipeline,
        limit: action.limit,
      });
      return readIntent(read, presentation);
    }
    case "skillSupplyDemand": {
      const range = rangeActionDates(action.range, options, "action.range");
      read = readActionSchema.parse({
        kind: action.kind,
        ...range,
        includePipeline: action.includePipeline,
        skill: action.skill,
      });
      return readIntent(read, presentation);
    }
    case "productHelp":
      read = readActionSchema.parse(action);
      return readIntent(read, presentation);
    case "findStaffingCandidates":
      read = readActionSchema.parse({
        kind: action.kind,
        demand: demandRef(action.demand, options, "demand", preserveAmbiguousNames),
        onDate: resolvePoint(action.onDate, options, "action.onDate"),
        includePipeline: action.includePipeline,
        minimumSkillMatches: action.minimumSkillMatches,
        limit: action.limit,
      });
      return readIntent(read, presentation);
    case "getTeamOverview":
      read = readActionSchema.parse({
        kind: action.kind,
        onDate: resolvePoint(action.onDate, options, "action.onDate"),
        includePipeline: action.includePipeline,
      });
      return readIntent(
        read,
        action.focus === "overallocated" ? "overallocated_consultants" : presentation,
      );
  }
}

function resolvedDemandFields(
  fields: Extract<SemanticWriteAction, { kind: "createDemand" }>["demand"],
  options: ValidatedOptions,
  field: string,
) {
  return {
    title: fields.title,
    ...(fields.client !== undefined ? { client: fields.client } : {}),
    ...(fields.type !== undefined ? { type: fields.type } : {}),
    ...(fields.status !== undefined ? { status: fields.status } : {}),
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    ...(fields.skills !== undefined ? { skills: fields.skills } : {}),
    ...(fields.startDate !== undefined
      ? { startDate: pointOrNull(fields.startDate, options, `${field}.startDate`) }
      : {}),
    ...(fields.endDate !== undefined
      ? { endDate: pointOrNull(fields.endDate, options, `${field}.endDate`) }
      : {}),
    ...(fields.requiredCapacity !== undefined ? { requiredCapacity: fields.requiredCapacity } : {}),
    ...(fields.owner !== undefined
      ? {
          owner:
            fields.owner === null ? null : consultantRef(fields.owner, options, `${field}.owner`),
        }
      : {}),
  };
}

function resolvedDemandPatch(
  patch: Extract<SemanticWriteAction, { kind: "updateDemand" }>["patch"],
  options: ValidatedOptions,
) {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.client !== undefined ? { client: patch.client } : {}),
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.skills !== undefined ? { skills: patch.skills } : {}),
    ...(patch.startDate !== undefined
      ? { startDate: pointOrNull(patch.startDate, options, "patch.startDate") }
      : {}),
    ...(patch.endDate !== undefined
      ? { endDate: pointOrNull(patch.endDate, options, "patch.endDate") }
      : {}),
    ...(patch.requiredCapacity !== undefined ? { requiredCapacity: patch.requiredCapacity } : {}),
    ...(patch.owner !== undefined
      ? { owner: patch.owner === null ? null : consultantRef(patch.owner, options, "patch.owner") }
      : {}),
  };
}

function asOfDate(action: ProposedAction, currentDate: string): string {
  if (action.kind === "addAvailabilityBlock") return action.startDate;
  if (action.kind === "removeAvailabilityBlock" && "consultant" in action.block)
    return action.block.startDate;
  if (action.kind === "createDemand" && action.demand.startDate) return action.demand.startDate;
  if (action.kind === "updateDemand" && action.patch.startDate) return action.patch.startDate;
  return currentDate;
}

function writeIntent(action: ProposedAction, currentDate: string): ActionableCapacityIntent {
  const validatedAction = proposedActionSchema.parse(action);
  return actionableCapacityIntentSchema.parse({
    type: "write",
    action: validatedAction,
    asOfDate: asOfDate(validatedAction, currentDate),
  });
}

function compileWrite(
  action: SemanticWriteAction,
  options: ValidatedOptions,
): ActionableCapacityIntent {
  switch (action.kind) {
    case "createConsultant":
      return writeIntent({ kind: action.kind, consultant: action.consultant }, options.currentDate);
    case "updateConsultant":
      return writeIntent(
        {
          kind: action.kind,
          consultant: consultantRef(action.consultant, options, "consultant"),
          patch: action.patch,
        },
        options.currentDate,
      );
    case "createDemand":
      return writeIntent(
        { kind: action.kind, demand: resolvedDemandFields(action.demand, options, "demand") },
        options.currentDate,
      );
    case "updateDemand":
      return writeIntent(
        {
          kind: action.kind,
          demand: demandRef(action.demand, options, "demand"),
          patch: resolvedDemandPatch(action.patch, options),
        },
        options.currentDate,
      );
    case "setAllocation":
      return writeIntent(
        {
          kind: action.kind,
          consultant: consultantRef(action.consultant, options, "consultant"),
          demand: demandRef(action.demand, options, "demand"),
          capacity: action.capacity,
        },
        options.currentDate,
      );
    case "removeAllocation":
      return writeIntent(
        {
          kind: action.kind,
          consultant: consultantRef(action.consultant, options, "consultant"),
          demand: demandRef(action.demand, options, "demand"),
        },
        options.currentDate,
      );
    case "addAvailabilityBlock":
      return writeIntent(
        {
          kind: action.kind,
          consultant: consultantRef(action.consultant, options, "consultant"),
          startDate: resolvePoint(action.startDate, options, "startDate"),
          endDate: resolvePoint(action.endDate, options, "endDate"),
          note: action.note,
        },
        options.currentDate,
      );
    case "removeAvailabilityBlock": {
      const consultant = consultantRef(action.block.consultant, options, "block.consultant");
      if (!("consultantId" in consultant)) {
        throw new CapacityActionFailure(
          "VALIDATION_ERROR",
          "Consultant reference was not resolved",
          {
            field: "block.consultant",
          },
        );
      }
      const startDate = resolvePoint(action.block.startDate, options, "block.startDate");
      const endDate = resolvePoint(action.block.endDate, options, "block.endDate");
      const block = options.data.availabilityBlocks.find(
        (item) =>
          item.consultantId === consultant.consultantId &&
          item.startDate === startDate &&
          item.endDate === endDate,
      );
      if (!block)
        throw new CapacityActionFailure("NOT_FOUND", "Availability block not found", {
          field: "block",
        });
      return writeIntent(
        { kind: action.kind, block: { availabilityBlockId: block.id } },
        options.currentDate,
      );
    }
  }
}

function compileRelativeWrite(
  operation: SemanticRelativeWriteOperation,
  asOf: SemanticPointTimeRef,
  options: ValidatedOptions,
): ActionableCapacityIntent {
  const common = { type: "relativeWrite" as const, asOfDate: resolvePoint(asOf, options, "asOf") };
  switch (operation.kind) {
    case "adjustConsultantCapacity":
      return actionableCapacityIntentSchema.parse({
        ...common,
        operation: {
          ...operation,
          consultant: consultantRef(operation.consultant, options, "consultant"),
        },
      });
    case "adjustAllocation":
      return actionableCapacityIntentSchema.parse({
        ...common,
        operation: {
          ...operation,
          consultant: consultantRef(operation.consultant, options, "consultant"),
          demand: demandRef(operation.demand, options, "demand"),
        },
      });
    case "adjustDemandCapacity":
      return actionableCapacityIntentSchema.parse({
        ...common,
        operation: { ...operation, demand: demandRef(operation.demand, options, "demand") },
      });
    case "changeConsultantSkill":
      return actionableCapacityIntentSchema.parse({
        ...common,
        operation: {
          ...operation,
          consultant: consultantRef(operation.consultant, options, "consultant"),
        },
      });
    case "updateConsultantProfile":
      return actionableCapacityIntentSchema.parse({
        ...common,
        operation: {
          ...operation,
          consultant: consultantRef(operation.consultant, options, "consultant"),
        },
      });
  }
}

/** Compile one already schema-validated Luna outcome without reading or mutating a repository. */
export function compileSemanticOutcome(
  input: SemanticOutcome,
  options: SemanticCompilerOptions,
): SemanticCompilerOutput {
  const outcome = semanticOutcomeSchema.parse(input);
  if (outcome.type === "unsupported") {
    return capacityIntentSchema.parse({ type: "unsupported", reason: outcome.reason });
  }
  if (
    outcome.type === "clarification" ||
    outcome.type === "multiple_changes" ||
    outcome.type === "conversation_or_help"
  ) {
    return outcome;
  }

  const validated = validateOptions(options);
  if (outcome.type === "read") return compileRead(outcome.action, validated, outcome.presentation);
  if (outcome.type === "write") return compileWrite(outcome.action, validated);
  return compileRelativeWrite(outcome.operation, outcome.asOf, validated);
}

/** Safe adapter for callers that want typed resolution failures instead of exceptions. */
export function tryCompileSemanticOutcome(
  input: SemanticOutcome,
  options: SemanticCompilerOptions,
): SemanticCompilerResult {
  try {
    return { ok: true, output: compileSemanticOutcome(input, options) };
  } catch (error) {
    if (error instanceof CapacityActionFailure) return { ok: false, error: error.detail };
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Semantic outcome is invalid" },
      };
    }
    throw error;
  }
}

/**
 * Build the normal actionable read shape while retaining an ambiguous model
 * reference as a name. The handler uses this only to enter the existing
 * authoritative candidate-clarification flow; it is never executed before
 * the candidate is selected.
 */
export function compileSemanticReadForClarification(
  input: SemanticOutcome,
  options: SemanticCompilerOptions,
): ActionableCapacityIntent {
  const outcome = semanticOutcomeSchema.parse(input);
  if (outcome.type !== "read") {
    throw new CapacityActionFailure(
      "VALIDATION_ERROR",
      "Only semantic reads can enter read clarification",
    );
  }
  const validated = validateOptions(options);
  return compileRead(outcome.action, validated, outcome.presentation, true);
}
