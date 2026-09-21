import { z } from "zod";

import { calendarDateSchema } from "./assistant-context";
import { demandStatusSchema, demandTypeSchema, levelSchema, roleSchema } from "./validation";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /\b(?:api[_ -]?key|access[_ -]?token|service[_ -]?role|authorization|password|secret|token|jwt)\s*[:=]\s*\S+/i;
const BEARER_TOKEN_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i;
const KNOWN_TOKEN_PATTERN = /\b(?:sk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b/i;
const SQL_PATTERN =
  /\b(?:select\s+\d+|select\s+.+\s+from|insert\s+into|update\s+\S+\s+set|delete\s+from|drop\s+table|alter\s+table|truncate\s+table)\b/i;

function addUnsafeSemanticTextIssues(value: string, ctx: z.RefinementCtx): void {
  if (UUID_PATTERN.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Raw IDs are not accepted" });
  }
  if (JWT_PATTERN.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "JWT-shaped values are not accepted" });
  }
  if (
    CREDENTIAL_ASSIGNMENT_PATTERN.test(value) ||
    BEARER_TOKEN_PATTERN.test(value) ||
    KNOWN_TOKEN_PATTERN.test(value)
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Credential values are not accepted" });
  }
  if (SQL_PATTERN.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "SQL payloads are not accepted" });
  }
}

/** Reusable value-level guard for model-supplied text; ordinary business labels remain valid. */
export const safeSemanticTextSchema = (maxLength: number, minLength = 1) =>
  z.string().trim().min(minLength).max(maxLength).superRefine(addUnsafeSemanticTextIssues);

const semanticEmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .superRefine(addUnsafeSemanticTextIssues);

const boundedText = safeSemanticTextSchema(200);
const boundedLongText = safeSemanticTextSchema(4_000, 0);
const boundedSkill = safeSemanticTextSchema(100);
const boundedSkills = z.array(boundedSkill).max(50);
const boundedInteger = z.number().int().finite();

const semanticNameSchema = boundedText;

/** A model-facing consultant reference. Resolution is compiler-owned. */
export const semanticConsultantRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("self") }).strict(),
  z.object({ kind: z.literal("current_context") }).strict(),
  z.object({ kind: z.literal("name"), name: semanticNameSchema }).strict(),
]);

/** A model-facing demand reference. Resolution is compiler-owned. */
export const semanticDemandRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current_context") }).strict(),
  z.object({ kind: z.literal("name"), name: semanticNameSchema }).strict(),
]);

const relativeWeekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

const semanticCurrentContextTimeSchema = z.object({ kind: z.literal("current_context") }).strict();

const semanticDateTimeSchema = z
  .object({ kind: z.literal("date"), date: calendarDateSchema })
  .strict();

const semanticRangeTimeSchema = z
  .object({
    kind: z.literal("range"),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  })
  .strict()
  .refine((value) => value.endDate >= value.startDate, {
    message: "End date cannot be before start date",
    path: ["endDate"],
  });

const semanticWeekOffsetTimeSchema = z
  .object({
    kind: z.literal("week_offset"),
    weeks: boundedInteger.min(-104).max(104),
  })
  .strict();

const semanticWeekRangeTimeSchema = z
  .object({
    kind: z.literal("week_range"),
    startWeekOffset: boundedInteger.min(-104).max(104),
    durationWeeks: boundedInteger.min(1).max(52),
  })
  .strict();

const semanticDaysFromTodayTimeSchema = z
  .object({
    kind: z.literal("days_from_today"),
    days: boundedInteger.min(-730).max(730),
  })
  .strict();

/** The smallest relative-weekday form needed by the semantic compiler. */
const semanticRelativeWeekdayTimeSchema = z
  .object({
    kind: z.literal("relative_weekday"),
    weekday: relativeWeekdaySchema,
    weekOffset: boundedInteger.min(-104).max(104).default(0),
  })
  .strict();

export const semanticTimeRefSchema = z
  .union([
    semanticCurrentContextTimeSchema,
    semanticDateTimeSchema,
    semanticRangeTimeSchema,
    semanticWeekOffsetTimeSchema,
    semanticWeekRangeTimeSchema,
    semanticDaysFromTodayTimeSchema,
    semanticRelativeWeekdayTimeSchema,
  ])
  .superRefine((value, ctx) => {
    if (value.kind === "range" && value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date cannot be before start date",
        path: ["endDate"],
      });
    }
  });

export const semanticPointTimeRefSchema = z.discriminatedUnion("kind", [
  semanticCurrentContextTimeSchema,
  semanticDateTimeSchema,
  semanticWeekOffsetTimeSchema,
  semanticDaysFromTodayTimeSchema,
  semanticRelativeWeekdayTimeSchema,
]);

type SemanticPointTimeValue = z.infer<typeof semanticPointTimeRefSchema>;

function addLiteralDateOrderIssue(
  startDate: SemanticPointTimeValue | null | undefined,
  endDate: SemanticPointTimeValue | null | undefined,
  ctx: z.RefinementCtx,
  path: (string | number)[] = ["endDate"],
): void {
  if (startDate?.kind === "date" && endDate?.kind === "date" && endDate.date < startDate.date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date cannot be before start date",
      path,
    });
  }
}

export const semanticRangeRefSchema = z.union([
  semanticCurrentContextTimeSchema,
  semanticRangeTimeSchema,
  semanticWeekOffsetTimeSchema,
  semanticWeekRangeTimeSchema,
]);

export const semanticConsultantRef = semanticConsultantRefSchema;
export const semanticDemandRef = semanticDemandRefSchema;
export const semanticTimeRef = semanticTimeRefSchema;

const includePipelineSchema = z.boolean().default(false);
const limitSchema = boundedInteger.min(1).max(100);
const defaultLimitSchema = limitSchema.default(20);
const minimumSkillMatchesSchema = boundedInteger.min(0).max(50);
const capacityFocusSchema = z.enum([
  "free",
  "committed",
  "pipeline",
  "utilization",
  "breakdown",
  "allocations",
]);
const teamFocusSchema = z.enum(["free", "committed", "pipeline", "utilization", "breakdown"]);
const skillsFilterSchema = z
  .object({ anyOf: boundedSkills.optional(), allOf: boundedSkills.optional() })
  .strict();

const listConsultantsSemanticReadSchema = z
  .object({
    kind: z.literal("listConsultants"),
    status: z.enum(["active", "archived", "all"]).default("active"),
    role: roleSchema.optional(),
    level: levelSchema.optional(),
    skills: skillsFilterSchema.optional(),
    onDate: semanticPointTimeRefSchema.optional(),
    includePipeline: includePipelineSchema,
    capacityFilter: z.enum(["any", "available"]).default("any"),
  })
  .strict()
  .refine((value) => value.capacityFilter === "any" || value.onDate !== undefined, {
    message: "Available-capacity queries require a time reference",
    path: ["onDate"],
  });

const listConsultantsRangeSemanticReadSchema = z
  .object({
    kind: z.literal("listConsultantsRange"),
    status: z.enum(["active", "archived", "all"]).default("active"),
    role: roleSchema.optional(),
    level: levelSchema.optional(),
    skills: skillsFilterSchema.optional(),
    range: semanticRangeRefSchema,
    includePipeline: includePipelineSchema,
    capacityFilter: z.enum(["any", "available"]).default("any"),
  })
  .strict();

const getConsultantSemanticReadSchema = z
  .object({
    kind: z.literal("getConsultant"),
    consultant: semanticConsultantRefSchema,
    onDate: semanticPointTimeRefSchema.optional(),
    includePipeline: includePipelineSchema,
  })
  .strict();

const listDemandsSemanticReadSchema = z
  .object({
    kind: z.literal("listDemands"),
    statuses: z.array(demandStatusSchema).max(4).optional(),
    types: z.array(demandTypeSchema).max(3).optional(),
    owner: semanticConsultantRefSchema.optional(),
    activeOn: semanticPointTimeRefSchema.optional(),
    skills: boundedSkills.optional(),
    includeClosed: z.boolean().default(true),
  })
  .strict();

const getDemandSemanticReadSchema = z
  .object({
    kind: z.literal("getDemand"),
    demand: semanticDemandRefSchema,
    onDate: semanticPointTimeRefSchema.optional(),
    focus: z.enum(["details", "staffing_gap"]).default("details"),
  })
  .strict();

const getCapacitySemanticReadSchema = z
  .object({
    kind: z.literal("getCapacity"),
    consultant: semanticConsultantRefSchema,
    onDate: semanticPointTimeRefSchema,
    includePipeline: includePipelineSchema,
    focus: capacityFocusSchema.default("free"),
  })
  .strict();

const getCapacityRangeSemanticReadSchema = z
  .object({
    kind: z.literal("getCapacityRange"),
    consultant: semanticConsultantRefSchema,
    range: semanticRangeRefSchema,
    includePipeline: includePipelineSchema,
    focus: capacityFocusSchema.default("free"),
  })
  .strict();

const getTeamOverviewRangeSemanticReadSchema = z
  .object({
    kind: z.literal("getTeamOverviewRange"),
    range: semanticRangeRefSchema,
    includePipeline: includePipelineSchema,
    role: roleSchema.optional(),
    level: levelSchema.optional(),
    focus: teamFocusSchema.optional(),
  })
  .strict();

const findAvailabilityWindowsSemanticReadSchema = z
  .object({
    kind: z.literal("findAvailabilityWindows"),
    consultant: semanticConsultantRefSchema.optional(),
    range: semanticRangeRefSchema,
    minimumFreeCapacity: boundedInteger.min(0).max(100),
    minimumWorkingDays: boundedInteger.min(1).max(262),
    includePipeline: includePipelineSchema,
  })
  .strict();

const findStaffingCandidatesRangeSemanticReadSchema = z
  .object({
    kind: z.literal("findStaffingCandidatesRange"),
    demand: semanticDemandRefSchema,
    range: semanticRangeRefSchema,
    includePipeline: includePipelineSchema,
    minimumSkillMatches: minimumSkillMatchesSchema.default(0),
    limit: defaultLimitSchema,
  })
  .strict();

const findSuitableDemandsSemanticReadSchema = z
  .object({
    kind: z.literal("findSuitableDemands"),
    consultant: semanticConsultantRefSchema,
    range: semanticRangeRefSchema,
    includePipeline: includePipelineSchema,
    limit: defaultLimitSchema,
  })
  .strict();

const skillSupplyDemandSemanticReadSchema = z
  .object({
    kind: z.literal("skillSupplyDemand"),
    range: semanticRangeRefSchema,
    includePipeline: includePipelineSchema,
    skill: boundedSkill.optional(),
  })
  .strict();

const productHelpTopicSchema = z.enum([
  "pipeline",
  "confirmed",
  "committedCapacity",
  "workingCapacity",
  "freeCapacity",
  "overAllocation",
  "candidateRanking",
  "includePipeline",
  "rfp",
  "assistantScope",
]);

const productHelpSemanticReadSchema = z
  .object({ kind: z.literal("productHelp"), topic: productHelpTopicSchema })
  .strict();

const findStaffingCandidatesSemanticReadSchema = z
  .object({
    kind: z.literal("findStaffingCandidates"),
    demand: semanticDemandRefSchema,
    onDate: semanticPointTimeRefSchema,
    includePipeline: includePipelineSchema,
    minimumSkillMatches: minimumSkillMatchesSchema.default(0),
    limit: defaultLimitSchema,
  })
  .strict();

const getTeamOverviewSemanticReadSchema = z
  .object({
    kind: z.literal("getTeamOverview"),
    onDate: semanticPointTimeRefSchema,
    includePipeline: includePipelineSchema,
    focus: z.enum(["overview", "overallocated"]).default("overview"),
  })
  .strict();

/** Closed semantic read family; every member has a deterministic Phase 2 target. */
export const semanticReadActionSchema = z.union([
  listConsultantsSemanticReadSchema,
  listConsultantsRangeSemanticReadSchema,
  getConsultantSemanticReadSchema,
  listDemandsSemanticReadSchema,
  getDemandSemanticReadSchema,
  getCapacitySemanticReadSchema,
  getCapacityRangeSemanticReadSchema,
  getTeamOverviewRangeSemanticReadSchema,
  findAvailabilityWindowsSemanticReadSchema,
  findStaffingCandidatesRangeSemanticReadSchema,
  findSuitableDemandsSemanticReadSchema,
  skillSupplyDemandSemanticReadSchema,
  productHelpSemanticReadSchema,
  findStaffingCandidatesSemanticReadSchema,
  getTeamOverviewSemanticReadSchema,
]);

const semanticCapacitySchema = boundedInteger.min(0).max(1000);
const semanticWorkingCapacitySchema = boundedInteger.min(0).max(100);
const semanticAllocationSchema = boundedInteger
  .min(5)
  .max(100)
  .refine((value) => value % 5 === 0, "Allocation capacity must use 5% increments");

const createConsultantSemanticWriteSchema = z
  .object({
    kind: z.literal("createConsultant"),
    consultant: z
      .object({
        name: boundedText,
        surname: boundedText,
        email: semanticEmailSchema.nullable().optional(),
        level: levelSchema.optional(),
        role: roleSchema.optional(),
        skills: boundedSkills.optional(),
        workingCapacity: semanticWorkingCapacitySchema.optional(),
      })
      .strict(),
  })
  .strict();

const updateConsultantSemanticWriteSchema = z
  .object({
    kind: z.literal("updateConsultant"),
    consultant: semanticConsultantRefSchema,
    patch: z
      .object({
        name: boundedText.optional(),
        surname: boundedText.optional(),
        email: semanticEmailSchema.nullable().optional(),
        level: levelSchema.optional(),
        role: roleSchema.optional(),
        skills: boundedSkills.optional(),
        workingCapacity: semanticWorkingCapacitySchema.optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "Patch cannot be empty"),
  })
  .strict();

const semanticDemandFieldsBaseSchema = z
  .object({
    title: boundedText,
    client: boundedText.optional(),
    type: demandTypeSchema.optional(),
    status: demandStatusSchema.optional(),
    description: boundedLongText.optional(),
    skills: boundedSkills.optional(),
    startDate: semanticPointTimeRefSchema.nullable().optional(),
    endDate: semanticPointTimeRefSchema.nullable().optional(),
    requiredCapacity: semanticCapacitySchema.optional(),
    owner: semanticConsultantRefSchema.nullable().optional(),
  })
  .strict();

const semanticDemandFieldsSchema = semanticDemandFieldsBaseSchema.superRefine((value, ctx) => {
  addLiteralDateOrderIssue(value.startDate, value.endDate, ctx);
});

const createDemandSemanticWriteSchema = z
  .object({ kind: z.literal("createDemand"), demand: semanticDemandFieldsSchema })
  .strict();

const updateDemandPatchSchema = semanticDemandFieldsBaseSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Patch cannot be empty")
  .superRefine((value, ctx) => {
    addLiteralDateOrderIssue(value.startDate, value.endDate, ctx);
  });

const updateDemandSemanticWriteSchema = z
  .object({
    kind: z.literal("updateDemand"),
    demand: semanticDemandRefSchema,
    patch: updateDemandPatchSchema,
  })
  .strict();

const setAllocationSemanticWriteSchema = z
  .object({
    kind: z.literal("setAllocation"),
    consultant: semanticConsultantRefSchema,
    demand: semanticDemandRefSchema,
    capacity: semanticAllocationSchema,
  })
  .strict();

const removeAllocationSemanticWriteSchema = z
  .object({
    kind: z.literal("removeAllocation"),
    consultant: semanticConsultantRefSchema,
    demand: semanticDemandRefSchema,
  })
  .strict();

const addAvailabilityBlockSemanticWriteSchema = z
  .object({
    kind: z.literal("addAvailabilityBlock"),
    consultant: semanticConsultantRefSchema,
    startDate: semanticPointTimeRefSchema,
    endDate: semanticPointTimeRefSchema,
    note: safeSemanticTextSchema(1_000, 0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    addLiteralDateOrderIssue(value.startDate, value.endDate, ctx);
  });

const removeAvailabilityBlockSemanticWriteSchema = z
  .object({
    kind: z.literal("removeAvailabilityBlock"),
    block: z
      .object({
        consultant: semanticConsultantRefSchema,
        startDate: semanticPointTimeRefSchema,
        endDate: semanticPointTimeRefSchema,
      })
      .strict()
      .superRefine((value, ctx) => {
        addLiteralDateOrderIssue(value.startDate, value.endDate, ctx, ["endDate"]);
      }),
  })
  .strict();

/** Closed semantic writes. They are preview candidates, never confirmations. */
export const semanticWriteActionSchema = z.union([
  createConsultantSemanticWriteSchema,
  updateConsultantSemanticWriteSchema,
  createDemandSemanticWriteSchema,
  updateDemandSemanticWriteSchema,
  setAllocationSemanticWriteSchema,
  removeAllocationSemanticWriteSchema,
  addAvailabilityBlockSemanticWriteSchema,
  removeAvailabilityBlockSemanticWriteSchema,
]);

const relativeWriteAsOfSchema = z.object({ asOf: semanticPointTimeRefSchema }).strict();

const adjustConsultantCapacitySchema = z
  .object({
    kind: z.literal("adjustConsultantCapacity"),
    consultant: semanticConsultantRefSchema,
    delta: boundedInteger.min(-100).max(100),
  })
  .strict();

const adjustAllocationSchema = z
  .object({
    kind: z.literal("adjustAllocation"),
    consultant: semanticConsultantRefSchema,
    demand: semanticDemandRefSchema,
    delta: boundedInteger.min(-100).max(100),
  })
  .strict();

const adjustDemandCapacitySchema = z
  .object({
    kind: z.literal("adjustDemandCapacity"),
    demand: semanticDemandRefSchema,
    delta: boundedInteger.min(-1000).max(1000),
  })
  .strict();

const changeConsultantSkillSchema = z
  .object({
    kind: z.literal("changeConsultantSkill"),
    consultant: semanticConsultantRefSchema,
    skill: boundedSkill,
    operation: z.enum(["add", "remove"]),
  })
  .strict();

const updateConsultantProfileSchema = z
  .object({
    kind: z.literal("updateConsultantProfile"),
    consultant: semanticConsultantRefSchema,
    role: roleSchema.optional(),
    level: levelSchema.optional(),
    skill: boundedSkill.optional(),
    operation: z.enum(["add", "remove"]).optional(),
  })
  .strict()
  .refine(
    (value) => value.role !== undefined || value.level !== undefined || value.skill !== undefined,
    "Relative profile update needs a role, level, or skill",
  )
  .refine((value) => value.skill === undefined || value.operation !== undefined, {
    message: "Skill profile changes require an add/remove operation",
    path: ["operation"],
  });

export const semanticRelativeWriteOperationSchema = z.union([
  adjustConsultantCapacitySchema,
  adjustAllocationSchema,
  adjustDemandCapacitySchema,
  changeConsultantSkillSchema,
  updateConsultantProfileSchema,
]);

export const semanticRelativeWriteSchema = z
  .object({
    operation: semanticRelativeWriteOperationSchema,
    asOf: semanticPointTimeRefSchema,
  })
  .strict();

export const semanticIntentFamilySchema = z.enum([
  "list_consultants",
  "list_consultants_range",
  "consultant_details",
  "list_demands",
  "demand_details",
  "capacity_point",
  "capacity_range",
  "team_overview_range",
  "team_overview",
  "availability_windows",
  "staffing_candidates_range",
  "staffing_candidates",
  "suitable_demands",
  "skill_supply_demand",
  "product_help",
  "create_consultant",
  "update_consultant",
  "create_demand",
  "update_demand",
  "set_allocation",
  "remove_allocation",
  "add_availability_block",
  "remove_availability_block",
  "adjust_consultant_capacity",
  "adjust_allocation",
  "adjust_demand_capacity",
  "change_consultant_skill",
  "update_consultant_profile",
]);

export const semanticMissingFieldSchema = z.enum([
  "consultant",
  "demand",
  "owner",
  "block",
  "date",
  "range",
  "start_date",
  "end_date",
  "surname",
  "capacity",
  "skills",
  "level",
  "role",
  "operation",
  "title",
  "client",
  "topic",
]);

/** Safe facts are semantic hints only; they cannot contain rows, IDs, or executable data. */
export const safeSemanticFactsSchema = z
  .object({
    consultant: semanticConsultantRefSchema.optional(),
    demand: semanticDemandRefSchema.optional(),
    time: semanticTimeRefSchema.optional(),
    name: boundedText.optional(),
    surname: boundedText.optional(),
    title: boundedText.optional(),
    client: boundedText.optional(),
    type: demandTypeSchema.optional(),
    status: demandStatusSchema.optional(),
    level: levelSchema.optional(),
    role: roleSchema.optional(),
    skills: boundedSkills.optional(),
    capacity: semanticCapacitySchema.optional(),
    delta: boundedInteger.min(-1000).max(1000).optional(),
    operation: z.enum(["add", "remove"]).optional(),
  })
  .strict();

export const semanticClarificationSchema = z
  .object({
    type: z.literal("clarification"),
    intentFamily: semanticIntentFamilySchema,
    knownFacts: safeSemanticFactsSchema,
    missing: z.array(semanticMissingFieldSchema).min(1).max(6),
    question: safeSemanticTextSchema(240),
    reason: safeSemanticTextSchema(400),
  })
  .strict();

export const semanticUnsupportedReasonSchema = z.enum([
  "destructive_action",
  "missing_information",
  "multiple_changes",
  "outside_capacity_hub",
  "security_request",
  "allocation_date_granularity",
  "partial_day_availability",
  "temporary_capacity_schedule",
  "history_undo_unavailable",
]);

export const semanticUnsupportedSchema = z
  .object({
    type: z.literal("unsupported"),
    reason: semanticUnsupportedReasonSchema,
  })
  .strict();

export const semanticMultipleChangesSchema = z
  .object({
    type: z.literal("multiple_changes"),
    changeCount: boundedInteger.min(2).max(8),
    reason: safeSemanticTextSchema(400),
  })
  .strict();

export const semanticConversationTopicSchema = z.enum([
  "greeting",
  "thanks",
  "clarification",
  "howToUse",
  ...productHelpTopicSchema.options,
]);

export const semanticConversationOrHelpSchema = z
  .object({
    type: z.literal("conversation_or_help"),
    topic: semanticConversationTopicSchema,
  })
  .strict();

export const semanticPresentationSchema = z.enum([
  "default",
  "available_consultants",
  "staffing_gap",
  "overallocated_consultants",
]);

export const semanticReadOutcomeSchema = z
  .object({
    type: z.literal("read"),
    action: semanticReadActionSchema,
    presentation: semanticPresentationSchema.default("default"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.presentation === "available_consultants" &&
      value.action.kind !== "listConsultants" &&
      value.action.kind !== "listConsultantsRange"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "available_consultants presentation requires a consultant-list action",
        path: ["presentation"],
      });
    }
    if (value.presentation === "staffing_gap" && value.action.kind !== "getDemand") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "staffing_gap presentation requires getDemand",
        path: ["presentation"],
      });
    }
    if (
      value.presentation === "overallocated_consultants" &&
      value.action.kind !== "getTeamOverview"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "overallocated_consultants presentation requires getTeamOverview",
        path: ["presentation"],
      });
    }
  });

/** The complete model-facing semantic result. Non-action outcomes contain no executable action. */
export const semanticOutcomeSchema = z.union([
  semanticReadOutcomeSchema,
  z.object({ type: z.literal("write"), action: semanticWriteActionSchema }).strict(),
  z
    .object({
      type: z.literal("relativeWrite"),
      ...relativeWriteAsOfSchema.shape,
      operation: semanticRelativeWriteOperationSchema,
    })
    .strict(),
  semanticClarificationSchema,
  semanticUnsupportedSchema,
  semanticMultipleChangesSchema,
  semanticConversationOrHelpSchema,
]);

export type SemanticConsultantRef = z.infer<typeof semanticConsultantRefSchema>;
export type SemanticDemandRef = z.infer<typeof semanticDemandRefSchema>;
export type SemanticTimeRef = z.infer<typeof semanticTimeRefSchema>;
export type SemanticPointTimeRef = z.infer<typeof semanticPointTimeRefSchema>;
export type SemanticRangeRef = z.infer<typeof semanticRangeRefSchema>;
export type SemanticReadAction = z.infer<typeof semanticReadActionSchema>;
export type SemanticWriteAction = z.infer<typeof semanticWriteActionSchema>;
export type SemanticRelativeWriteOperation = z.infer<typeof semanticRelativeWriteOperationSchema>;
export type SemanticRelativeWrite = z.infer<typeof semanticRelativeWriteSchema>;
export type SemanticIntentFamily = z.infer<typeof semanticIntentFamilySchema>;
export type SemanticMissingField = z.infer<typeof semanticMissingFieldSchema>;
export type SafeSemanticFacts = z.infer<typeof safeSemanticFactsSchema>;
export type SemanticClarification = z.infer<typeof semanticClarificationSchema>;
export type SemanticUnsupported = z.infer<typeof semanticUnsupportedSchema>;
export type SemanticMultipleChanges = z.infer<typeof semanticMultipleChangesSchema>;
export type SemanticConversationOrHelp = z.infer<typeof semanticConversationOrHelpSchema>;
export type SemanticPresentation = z.infer<typeof semanticPresentationSchema>;
export type SemanticReadOutcome = z.infer<typeof semanticReadOutcomeSchema>;
export type SemanticOutcome = z.infer<typeof semanticOutcomeSchema>;

// Kept explicit so Stage 3 can import a named schema without depending on the outcome union.
export const semanticRelativeWriteOutcomeSchema = z
  .object({
    type: z.literal("relativeWrite"),
    operation: semanticRelativeWriteOperationSchema,
    asOf: semanticPointTimeRefSchema,
  })
  .strict();
