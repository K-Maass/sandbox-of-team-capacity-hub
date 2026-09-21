import type { IbmFunctionTool } from "@/lib/ibm-ai.server";
import {
  semanticOutcomeSchema as canonicalSemanticOutcomeSchema,
  type SemanticOutcome,
} from "@/domain/capacity/assistant-semantic";

type JsonSchema = Record<string, unknown>;

const roles = ["Strategy", "Data", "Engineering", "Design", "Product", "Operations"];
const levels = ["Junior", "Consultant", "Senior", "Manager", "Partner"];
const demandTypes = ["Project", "Topic", "RfP"];
const demandStatuses = ["Incoming", "Won", "In Progress", "Lost"];
const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const productHelpTopics = [
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
];

const semanticIntentFamilies = [
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
];

const missingFields = [
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
];

const enumSchema = (values: readonly string[]): JsonSchema => ({
  type: "string",
  enum: [...values],
});

const dateSchema: JsonSchema = {
  type: "string",
  format: "date",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
};

const integer = (minimum: number, maximum: number): JsonSchema => ({
  type: "integer",
  minimum,
  maximum,
});

const limitSchema: JsonSchema = {
  type: "integer",
  minimum: 1,
  maximum: 100,
  default: 20,
  description: "Optional; defaults to 20 and cannot exceed 100.",
};

const allocationSchema: JsonSchema = {
  type: "integer",
  minimum: 5,
  maximum: 100,
  multipleOf: 5,
};

/**
 * IBM's Responses endpoint does not accept the discriminated `oneOf` tree used
 * by the canonical semantic contract. Keep the provider envelope as one
 * closed object and let the canonical parser below enforce the discriminators
 * and outcome-specific requirements after the call returns.
 */
function providerObjectSchema(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function providerOptional(schema: JsonSchema): JsonSchema {
  if (typeof schema.type !== "string") throw new Error("PROVIDER_SCHEMA_TYPE_REQUIRED");
  const output: JsonSchema = { ...schema, type: [schema.type, "null"] };
  if (Array.isArray(schema.enum)) output.enum = [...schema.enum, null];
  return output;
}
const providerSafeText = (maxLength = 200, minLength = 1): JsonSchema => ({
  type: "string",
  minLength,
  maxLength,
});
const providerSafeLongText = (maxLength = 4_000): JsonSchema => ({
  type: "string",
  maxLength,
});
const providerSkillsArraySchema: JsonSchema = {
  type: "array",
  items: providerSafeText(100),
  maxItems: 50,
};

const providerTimeRefSchema = providerObjectSchema({
  kind: enumSchema([
    "current_context",
    "date",
    "range",
    "week_offset",
    "week_range",
    "days_from_today",
    "relative_weekday",
  ]),
  date: providerOptional(dateSchema),
  startDate: providerOptional(dateSchema),
  endDate: providerOptional(dateSchema),
  weeks: providerOptional(integer(-104, 104)),
  startWeekOffset: providerOptional(integer(-104, 104)),
  durationWeeks: providerOptional(integer(1, 52)),
  days: providerOptional(integer(-730, 730)),
  weekday: providerOptional(enumSchema(weekdays)),
  weekOffset: providerOptional(integer(-104, 104)),
});

const providerConsultantValueSchema = providerObjectSchema({
  kind: providerOptional(enumSchema(["self", "current_context", "name"])),
  name: providerOptional(providerSafeText()),
  surname: providerOptional(providerSafeText()),
  email: providerOptional({ type: "string", format: "email", maxLength: 320 }),
  level: providerOptional(enumSchema(levels)),
  role: providerOptional(enumSchema(roles)),
  skills: providerOptional(providerSkillsArraySchema),
  workingCapacity: providerOptional(integer(0, 100)),
});

const providerDemandValueSchema = providerObjectSchema({
  kind: providerOptional(enumSchema(["current_context", "name"])),
  name: providerOptional(providerSafeText()),
  title: providerOptional(providerSafeText()),
  client: providerOptional(providerSafeText()),
  type: providerOptional(enumSchema(demandTypes)),
  status: providerOptional(enumSchema(demandStatuses)),
  description: providerOptional(providerSafeLongText()),
  skills: providerOptional(providerSkillsArraySchema),
  startDate: providerOptional(providerTimeRefSchema),
  endDate: providerOptional(providerTimeRefSchema),
  requiredCapacity: providerOptional(integer(0, 1000)),
  owner: providerOptional(providerConsultantValueSchema),
});

const providerConsultantRefSchema = providerObjectSchema({
  kind: enumSchema(["self", "current_context", "name"]),
  name: providerOptional(providerSafeText()),
});

const providerDemandRefSchema = providerObjectSchema({
  kind: enumSchema(["current_context", "name"]),
  name: providerOptional(providerSafeText()),
});

const providerConsultantCreateSchema = providerObjectSchema({
  name: providerSafeText(),
  surname: providerSafeText(),
  email: providerOptional({ type: "string", format: "email", maxLength: 320 }),
  level: providerOptional(enumSchema(levels)),
  role: providerOptional(enumSchema(roles)),
  skills: providerOptional(providerSkillsArraySchema),
  workingCapacity: providerOptional(integer(0, 100)),
});

const providerDemandCreateSchema = providerObjectSchema({
  title: providerSafeText(),
  client: providerOptional(providerSafeText()),
  type: providerOptional(enumSchema(demandTypes)),
  status: providerOptional(enumSchema(demandStatuses)),
  description: providerOptional(providerSafeLongText()),
  skills: providerOptional(providerSkillsArraySchema),
  startDate: providerOptional(providerTimeRefSchema),
  endDate: providerOptional(providerTimeRefSchema),
  requiredCapacity: providerOptional(integer(0, 1000)),
  owner: providerOptional(providerConsultantRefSchema),
});

const providerPatchSchema = providerObjectSchema({
  name: providerOptional(providerSafeText()),
  surname: providerOptional(providerSafeText()),
  email: providerOptional({ type: "string", format: "email", maxLength: 320 }),
  level: providerOptional(enumSchema(levels)),
  role: providerOptional(enumSchema(roles)),
  skills: providerOptional(providerSkillsArraySchema),
  workingCapacity: providerOptional(integer(0, 100)),
  archived: providerOptional({ type: "boolean" }),
  title: providerOptional(providerSafeText()),
  client: providerOptional(providerSafeText()),
  type: providerOptional(enumSchema(demandTypes)),
  status: providerOptional(enumSchema(demandStatuses)),
  description: providerOptional(providerSafeLongText()),
  startDate: providerOptional(providerTimeRefSchema),
  endDate: providerOptional(providerTimeRefSchema),
  requiredCapacity: providerOptional(integer(0, 1000)),
  owner: providerOptional(providerConsultantRefSchema),
  clearEmail: providerOptional({ type: "boolean" }),
  clearStartDate: providerOptional({ type: "boolean" }),
  clearEndDate: providerOptional({ type: "boolean" }),
  clearOwner: providerOptional({ type: "boolean" }),
});

const providerBlockSchema = providerObjectSchema({
  consultant: providerOptional(providerConsultantRefSchema),
  startDate: providerOptional(providerTimeRefSchema),
  endDate: providerOptional(providerTimeRefSchema),
});

const readActionKinds = [
  "listConsultants",
  "listConsultantsRange",
  "getConsultant",
  "listDemands",
  "getDemand",
  "getCapacity",
  "getCapacityRange",
  "getTeamOverviewRange",
  "findAvailabilityWindows",
  "findStaffingCandidatesRange",
  "findSuitableDemands",
  "skillSupplyDemand",
  "productHelp",
  "findStaffingCandidates",
  "getTeamOverview",
] as const;

const writeActionKinds = [
  "createConsultant",
  "updateConsultant",
  "createDemand",
  "updateDemand",
  "setAllocation",
  "removeAllocation",
  "addAvailabilityBlock",
  "removeAvailabilityBlock",
] as const;

const relativeWriteKinds = [
  "adjustConsultantCapacity",
  "adjustAllocation",
  "adjustDemandCapacity",
  "changeConsultantSkill",
  "updateConsultantProfile",
] as const;

const providerCommonActionProperties: Record<string, JsonSchema> = {
  consultant: providerOptional(providerConsultantRefSchema),
  demand: providerOptional(providerDemandRefSchema),
};

function providerActionSchema(
  kinds: readonly string[],
  properties: Record<string, JsonSchema>,
  kindDescription: string,
): JsonSchema {
  return providerObjectSchema({
    kind: { ...enumSchema(kinds), description: kindDescription },
    ...properties,
  });
}

const providerReadActionSchema = providerActionSchema(
  readActionKinds,
  {
    ...providerCommonActionProperties,
    range: providerOptional(providerTimeRefSchema),
    onDate: providerOptional(providerTimeRefSchema),
    activeOn: providerOptional(providerTimeRefSchema),
    includePipeline: providerOptional({ type: "boolean" }),
    consultantStatus: providerOptional(enumSchema(["active", "archived", "all"])),
    demandStatuses: providerOptional({
      type: "array",
      items: enumSchema(demandStatuses),
      maxItems: 4,
    }),
    demandTypes: providerOptional({ type: "array", items: enumSchema(demandTypes), maxItems: 3 }),
    demandOwner: providerOptional(providerConsultantRefSchema),
    includeClosed: providerOptional({ type: "boolean" }),
    consultantRole: providerOptional(enumSchema(roles)),
    consultantLevel: providerOptional(enumSchema(levels)),
    teamRole: providerOptional(enumSchema(roles)),
    teamLevel: providerOptional(enumSchema(levels)),
    consultantSkills: providerOptional(providerSkillsArraySchema),
    consultantSkillsAnyOf: providerOptional(providerSkillsArraySchema),
    consultantSkillsAllOf: providerOptional(providerSkillsArraySchema),
    demandSkills: providerOptional(providerSkillsArraySchema),
    consultantCapacityFilter: providerOptional(enumSchema(["any", "available"])),
    capacityFocus: providerOptional(
      enumSchema(["free", "committed", "pipeline", "utilization", "breakdown", "allocations"]),
    ),
    demandFocus: providerOptional(enumSchema(["details", "staffing_gap"])),
    teamFocus: providerOptional(
      enumSchema(["free", "committed", "pipeline", "utilization", "breakdown"]),
    ),
    overviewFocus: providerOptional(enumSchema(["overview", "overallocated"])),
    availabilityMinimumFreeCapacity: providerOptional(integer(0, 100)),
    availabilityMinimumWorkingDays: providerOptional(integer(1, 262)),
    candidateMinimumSkillMatches: providerOptional(integer(0, 50)),
    candidateLimit: providerOptional(limitSchema),
    suitableLimit: providerOptional(limitSchema),
    helpTopic: providerOptional(enumSchema(productHelpTopics)),
    skillQuery: providerOptional(providerSafeText(100)),
  },
  "Choose the single read action matching the user's goal. Use listConsultants for WHICH people have capacity or match consultant criteria at a point date, and listConsultantsRange for WHICH people have capacity or match consultant criteria across a range. Use getCapacity for one consultant at a point date, getCapacityRange for one consultant over a range, getTeamOverviewRange only for aggregate team capacity over a range, and getTeamOverview only for aggregate point-in-time team totals. Use findAvailabilityWindows only for explicit thresholded open-window searches, findSuitableDemands only for demands a named consultant could take on, findStaffingCandidatesRange only for people who could staff a named demand, and getConsultant for consultant details without focus.",
);

const providerWriteActionSchema = providerActionSchema(
  writeActionKinds,
  {
    consultantRef: providerOptional(providerConsultantRefSchema),
    consultantCreate: providerOptional(providerConsultantCreateSchema),
    demandRef: providerOptional(providerDemandRefSchema),
    demandCreate: providerOptional(providerDemandCreateSchema),
    startDate: providerOptional(providerTimeRefSchema),
    endDate: providerOptional(providerTimeRefSchema),
    patch: providerOptional(providerPatchSchema),
    block: providerOptional(providerBlockSchema),
    note: providerOptional(providerSafeLongText(1_000)),
    capacity: providerOptional(allocationSchema),
  },
  "Choose one exact write kind. setAllocation and removeAllocation use only consultantRef, demandRef, and capacity where applicable and do not require dates. createConsultant requires name and surname; level, role, skills, and working capacity have product defaults.",
);

const providerRelativeWriteOperationSchema = providerActionSchema(
  relativeWriteKinds,
  {
    ...providerCommonActionProperties,
    role: providerOptional(enumSchema(roles)),
    level: providerOptional(enumSchema(levels)),
    delta: providerOptional(integer(-1_000, 1_000)),
    skill: providerOptional(providerSafeText(100)),
    operation: providerOptional(enumSchema(["add", "remove"])),
  },
  "Choose one exact relative operation. Use relative writes for deltas or add/remove skill changes, not for ordinary reads, absolute patches, or date-specific allocation requests.",
);

const providerFactsSchema = providerObjectSchema({
  consultant: providerOptional(providerConsultantRefSchema),
  demand: providerOptional(providerDemandRefSchema),
  time: providerOptional(providerTimeRefSchema),
  name: providerOptional(providerSafeText()),
  surname: providerOptional(providerSafeText()),
  title: providerOptional(providerSafeText()),
  client: providerOptional(providerSafeText()),
  type: providerOptional(enumSchema(demandTypes)),
  status: providerOptional(enumSchema(demandStatuses)),
  level: providerOptional(enumSchema(levels)),
  role: providerOptional(enumSchema(roles)),
  skills: providerOptional(providerSkillsArraySchema),
  capacity: providerOptional(integer(0, 1000)),
  delta: providerOptional(integer(-1_000, 1_000)),
  operation: providerOptional(enumSchema(["add", "remove"])),
});

const providerReadOutcomeSchema = providerObjectSchema({
  action: providerReadActionSchema,
  presentation: providerOptional(
    enumSchema(["default", "available_consultants", "staffing_gap", "overallocated_consultants"]),
  ),
});

const providerWriteOutcomeSchema = providerObjectSchema({ action: providerWriteActionSchema });

const providerRelativeWriteOutcomeSchema = providerObjectSchema({
  operation: providerRelativeWriteOperationSchema,
  asOf: providerTimeRefSchema,
});

const providerClarificationOutcomeSchema = providerObjectSchema({
  intentFamily: enumSchema(semanticIntentFamilies),
  knownFacts: providerFactsSchema,
  missing: {
    type: "array",
    items: enumSchema(missingFields),
    minItems: 1,
    maxItems: 6,
  },
  question: providerSafeText(240),
  reason: providerSafeText(400),
});

const providerUnsupportedOutcomeSchema = providerObjectSchema({
  reason: enumSchema([
    "destructive_action",
    "missing_information",
    "multiple_changes",
    "outside_capacity_hub",
    "security_request",
    "allocation_date_granularity",
    "partial_day_availability",
    "temporary_capacity_schedule",
    "history_undo_unavailable",
  ]),
});

const providerMultipleChangesOutcomeSchema = providerObjectSchema({
  changeCount: integer(2, 8),
  reason: providerSafeText(400),
});

const providerConversationHelpOutcomeSchema = providerObjectSchema({
  topic: enumSchema(["greeting", "thanks", "clarification", "howToUse", ...productHelpTopics]),
});

const providerToolDefinitions = [
  {
    name: "emit_capacity_read",
    description: "Emit exactly one Capacity Hub read semantic outcome.",
    type: "read",
    parameters: providerReadOutcomeSchema,
  },
  {
    name: "emit_capacity_write",
    description: "Emit exactly one Capacity Hub preview-only write semantic outcome.",
    type: "write",
    parameters: providerWriteOutcomeSchema,
  },
  {
    name: "emit_capacity_relative_write",
    description: "Emit exactly one Capacity Hub relative-write semantic outcome for preview.",
    type: "relativeWrite",
    parameters: providerRelativeWriteOutcomeSchema,
  },
  {
    name: "emit_capacity_clarification",
    description: "Emit exactly one bounded Capacity Hub clarification semantic outcome.",
    type: "clarification",
    parameters: providerClarificationOutcomeSchema,
  },
  {
    name: "emit_capacity_unsupported",
    description: "Emit exactly one Capacity Hub unsupported semantic outcome.",
    type: "unsupported",
    parameters: providerUnsupportedOutcomeSchema,
  },
  {
    name: "emit_capacity_multiple_changes",
    description: "Emit exactly one Capacity Hub multiple-changes semantic outcome.",
    type: "multiple_changes",
    parameters: providerMultipleChangesOutcomeSchema,
  },
  {
    name: "emit_capacity_conversation_help",
    description: "Emit exactly one Capacity Hub conversation-or-help semantic outcome.",
    type: "conversation_or_help",
    parameters: providerConversationHelpOutcomeSchema,
  },
] as const;

type ProviderToolName = (typeof providerToolDefinitions)[number]["name"];

const providerToolByName: Record<ProviderToolName, (typeof providerToolDefinitions)[number]> =
  Object.fromEntries(providerToolDefinitions.map((tool) => [tool.name, tool])) as Record<
    ProviderToolName,
    (typeof providerToolDefinitions)[number]
  >;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ProviderNormalizationShape =
  | "root"
  | "action"
  | "operation"
  | "time"
  | "consultantRef"
  | "consultantFields"
  | "demandRef"
  | "demandFields"
  | "patchConsultant"
  | "patchDemand"
  | "facts"
  | "block"
  | "skillFilter";

const providerShapeKeys: Record<ProviderNormalizationShape, ReadonlySet<string>> = {
  root: new Set([
    "outcome",
    "action",
    "operation",
    "asOf",
    "presentation",
    "intentFamily",
    "knownFacts",
    "missing",
    "question",
    "reason",
    "changeCount",
    "topic",
  ]),
  action: new Set([
    "kind",
    "consultant",
    "consultantRef",
    "consultantCreate",
    "demand",
    "demandRef",
    "demandCreate",
    "range",
    "onDate",
    "activeOn",
    "startDate",
    "endDate",
    "includePipeline",
    "status",
    "statuses",
    "types",
    "owner",
    "includeClosed",
    "role",
    "level",
    "skills",
    "skillsAnyOf",
    "skillsAllOf",
    "capacityFilter",
    "focus",
    "minimumFreeCapacity",
    "minimumWorkingDays",
    "minimumSkillMatches",
    "limit",
    "topic",
    "capacity",
    "note",
    "block",
    "patch",
    "delta",
    "skill",
    "operation",
    "consultantStatus",
    "demandStatuses",
    "demandTypes",
    "demandOwner",
    "consultantRole",
    "consultantLevel",
    "teamRole",
    "teamLevel",
    "consultantSkills",
    "consultantSkillsAnyOf",
    "consultantSkillsAllOf",
    "demandSkills",
    "consultantCapacityFilter",
    "capacityFocus",
    "demandFocus",
    "teamFocus",
    "overviewFocus",
    "availabilityMinimumFreeCapacity",
    "availabilityMinimumWorkingDays",
    "candidateMinimumSkillMatches",
    "candidateLimit",
    "suitableLimit",
    "helpTopic",
    "skillQuery",
  ]),
  operation: new Set([
    "kind",
    "consultant",
    "demand",
    "range",
    "onDate",
    "activeOn",
    "startDate",
    "endDate",
    "includePipeline",
    "status",
    "statuses",
    "types",
    "owner",
    "includeClosed",
    "role",
    "level",
    "skills",
    "skillsAnyOf",
    "skillsAllOf",
    "capacityFilter",
    "focus",
    "minimumFreeCapacity",
    "minimumWorkingDays",
    "minimumSkillMatches",
    "limit",
    "topic",
    "capacity",
    "note",
    "block",
    "patch",
    "delta",
    "skill",
    "operation",
  ]),
  time: new Set([
    "kind",
    "date",
    "startDate",
    "endDate",
    "weeks",
    "startWeekOffset",
    "durationWeeks",
    "days",
    "weekday",
    "weekOffset",
  ]),
  consultantRef: new Set([
    "kind",
    "name",
    "surname",
    "email",
    "level",
    "role",
    "skills",
    "workingCapacity",
  ]),
  consultantFields: new Set([
    "kind",
    "name",
    "surname",
    "email",
    "level",
    "role",
    "skills",
    "workingCapacity",
  ]),
  demandRef: new Set([
    "kind",
    "name",
    "title",
    "client",
    "type",
    "status",
    "description",
    "skills",
    "startDate",
    "endDate",
    "requiredCapacity",
    "owner",
  ]),
  demandFields: new Set([
    "kind",
    "name",
    "title",
    "client",
    "type",
    "status",
    "description",
    "skills",
    "startDate",
    "endDate",
    "requiredCapacity",
    "owner",
  ]),
  patchConsultant: new Set([
    "name",
    "surname",
    "email",
    "level",
    "role",
    "skills",
    "workingCapacity",
    "archived",
    "title",
    "client",
    "type",
    "status",
    "description",
    "startDate",
    "endDate",
    "requiredCapacity",
    "owner",
    "clearEmail",
    "clearStartDate",
    "clearEndDate",
    "clearOwner",
  ]),
  patchDemand: new Set([
    "name",
    "surname",
    "email",
    "level",
    "role",
    "skills",
    "workingCapacity",
    "archived",
    "title",
    "client",
    "type",
    "status",
    "description",
    "startDate",
    "endDate",
    "requiredCapacity",
    "owner",
    "clearEmail",
    "clearStartDate",
    "clearEndDate",
    "clearOwner",
  ]),
  facts: new Set([
    "consultant",
    "demand",
    "time",
    "name",
    "surname",
    "title",
    "client",
    "type",
    "status",
    "level",
    "role",
    "skills",
    "capacity",
    "delta",
    "operation",
  ]),
  block: new Set(["consultant", "startDate", "endDate"]),
  skillFilter: new Set(["anyOf", "allOf"]),
};

function providerKeepNullKeys(shape: ProviderNormalizationShape): ReadonlySet<string> {
  return new Set();
}

function applyProviderClearMarkers(
  output: Record<string, unknown>,
  shape: ProviderNormalizationShape,
): void {
  const markers =
    shape === "patchConsultant"
      ? [["clearEmail", "email"]]
      : shape === "patchDemand"
        ? [
            ["clearStartDate", "startDate"],
            ["clearEndDate", "endDate"],
            ["clearOwner", "owner"],
          ]
        : [];
  for (const [marker, field] of markers) {
    if (output[marker] === true && output[field] === undefined) {
      output[field] = null;
      delete output[marker];
    } else if (output[marker] !== true) {
      delete output[marker];
    }
  }
}

function providerChildShape(
  shape: ProviderNormalizationShape,
  key: string,
  value: Record<string, unknown>,
): ProviderNormalizationShape | undefined {
  if (shape === "root") {
    if (key === "action") return "action";
    if (key === "operation") return "operation";
    if (key === "asOf") return "time";
    if (key === "knownFacts") return "facts";
    return undefined;
  }

  if (shape === "action" || shape === "operation") {
    if (key === "consultantRef") return "consultantRef";
    if (key === "consultantCreate") return "consultantFields";
    if (key === "consultant") {
      return shape === "action" && value.kind === "createConsultant"
        ? "consultantFields"
        : "consultantRef";
    }
    if (key === "demandRef") return "demandRef";
    if (key === "demandCreate") return "demandFields";
    if (key === "demand") {
      return shape === "action" && value.kind === "createDemand" ? "demandFields" : "demandRef";
    }
    if (key === "owner" || key === "demandOwner") return "consultantRef";
    if (key === "patch") {
      if (value.kind === "updateConsultant") return "patchConsultant";
      if (value.kind === "updateDemand") return "patchDemand";
    }
    if (key === "block") return "block";
    if (["range", "onDate", "activeOn", "startDate", "endDate"].includes(key)) return "time";
    if (key === "skills" && isRecord(value.skills)) return "skillFilter";
    return undefined;
  }

  if (shape === "demandFields" || shape === "patchDemand") {
    if (key === "owner") return "consultantRef";
    if (key === "startDate" || key === "endDate") return "time";
    return undefined;
  }

  if (shape === "facts") {
    if (key === "consultant") return "consultantRef";
    if (key === "demand") return "demandRef";
    if (key === "time") return "time";
    return undefined;
  }

  if (shape === "block") {
    if (key === "consultant") return "consultantRef";
    if (key === "startDate" || key === "endDate") return "time";
  }
  return undefined;
}

/** Remove only the explicit null placeholders required by IBM strict schemas. */
function normalizeProviderValue(value: unknown, shape: ProviderNormalizationShape): unknown {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return value;

  const knownKeys = providerShapeKeys[shape];
  const keepNullKeys = providerKeepNullKeys(shape);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null && knownKeys.has(key) && !keepNullKeys.has(key)) continue;
    const childShape = providerChildShape(shape, key, value);
    output[key] = childShape ? normalizeProviderValue(child, childShape) : child;
  }
  if (shape === "action") {
    const kind = value.kind;
    const aliases: Record<string, string> = {
      ...((kind === "listConsultants" || kind === "listConsultantsRange")
        ? {
            consultantStatus: "status",
            consultantRole: "role",
            consultantLevel: "level",
            consultantCapacityFilter: "capacityFilter",
            consultantSkillsAnyOf: "skillsAnyOf",
            consultantSkillsAllOf: "skillsAllOf",
            consultantSkills: "skills",
          }
        : {}),
      ...(kind === "listDemands"
        ? {
            demandStatuses: "statuses",
            demandTypes: "types",
            demandOwner: "owner",
            demandSkills: "skills",
          }
        : {}),
      ...(kind === "getCapacity" || kind === "getCapacityRange" ? { capacityFocus: "focus" } : {}),
      ...(kind === "getDemand" ? { demandFocus: "focus" } : {}),
      ...(kind === "getTeamOverviewRange"
        ? { teamFocus: "focus", teamRole: "role", teamLevel: "level" }
        : {}),
      ...(kind === "getTeamOverview" ? { overviewFocus: "focus" } : {}),
      ...(kind === "findAvailabilityWindows"
        ? {
            availabilityMinimumFreeCapacity: "minimumFreeCapacity",
            availabilityMinimumWorkingDays: "minimumWorkingDays",
          }
        : {}),
      ...(kind === "findStaffingCandidates" || kind === "findStaffingCandidatesRange"
        ? {
            candidateMinimumSkillMatches: "minimumSkillMatches",
            candidateLimit: "limit",
          }
        : {}),
      ...(kind === "findSuitableDemands" ? { suitableLimit: "limit" } : {}),
      ...(kind === "productHelp" ? { helpTopic: "topic" } : {}),
      ...(kind === "skillSupplyDemand" ? { skillQuery: "skill" } : {}),
    };
    for (const [providerKey, canonicalKey] of Object.entries(aliases)) {
      if (output[providerKey] !== undefined && output[canonicalKey] === undefined) {
        output[canonicalKey] = output[providerKey];
        delete output[providerKey];
      }
    }

    const consultantVariants = [output.consultantRef, output.consultantCreate].filter(
      (item) => item !== undefined,
    );
    if (consultantVariants.length === 1) {
      output.consultant = consultantVariants[0];
      delete output.consultantRef;
      delete output.consultantCreate;
    }

    const demandVariants = [output.demandRef, output.demandCreate].filter(
      (item) => item !== undefined,
    );
    if (demandVariants.length === 1) {
      output.demand = demandVariants[0];
      delete output.demandRef;
      delete output.demandCreate;
    }

    const hasSkillAliases = output.skillsAnyOf !== undefined || output.skillsAllOf !== undefined;
    if (hasSkillAliases && output.skills === undefined) {
      output.skills = {
        ...(output.skillsAnyOf !== undefined ? { anyOf: output.skillsAnyOf } : {}),
        ...(output.skillsAllOf !== undefined ? { allOf: output.skillsAllOf } : {}),
      };
      delete output.skillsAnyOf;
      delete output.skillsAllOf;
    }

    if (
      (value.kind === "listConsultants" || value.kind === "listConsultantsRange") &&
      Array.isArray(output.skills)
    ) {
      output.skills = { anyOf: output.skills };
    }

    const statusKey =
      kind === "listConsultants" || kind === "listConsultantsRange"
        ? "consultantStatus"
        : kind === "listDemands"
          ? "demandStatus"
          : undefined;
    if (statusKey && output[statusKey] !== undefined) {
      output.status = output[statusKey];
      delete output[statusKey];
    }

    const focusKey =
      kind === "getCapacity" || kind === "getCapacityRange"
        ? "capacityFocus"
        : kind === "getDemand"
          ? "demandFocus"
          : kind === "getTeamOverviewRange"
            ? "teamFocus"
            : kind === "getTeamOverview"
              ? "overviewFocus"
              : undefined;
    if (focusKey && output[focusKey] !== undefined) {
      output.focus = output[focusKey];
      delete output[focusKey];
    }
  }
  if (shape === "patchConsultant" || shape === "patchDemand")
    applyProviderClearMarkers(output, shape);
  return output;
}

/** Seven strict native functions: each emits one root semantic family only. */
export const CAPACITY_ASSISTANT_TOOLS_V2: IbmFunctionTool[] = providerToolDefinitions.map(
  (tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true as const,
  }),
);
export const CAPACITY_SEMANTIC_TOOLS = CAPACITY_ASSISTANT_TOOLS_V2;

/** Deterministic Stage 3 boundary: tool name selects the canonical root type. */
export function parseSemanticToolCall(name: string, rawArguments: string): SemanticOutcome {
  if (!Object.prototype.hasOwnProperty.call(providerToolByName, name))
    throw new Error("UNKNOWN_SEMANTIC_TOOL");

  let value: unknown;
  try {
    value = JSON.parse(rawArguments);
  } catch {
    throw new Error("INVALID_SEMANTIC_TOOL_ARGUMENTS");
  }

  if (!isRecord(value)) {
    throw new Error("INVALID_SEMANTIC_TOOL_ARGUMENTS");
  }
  if ("type" in value || "outcome" in value) {
    throw new Error("INVALID_SEMANTIC_TOOL_ARGUMENTS");
  }

  const { type } = providerToolByName[name as ProviderToolName];
  const normalizedFields = normalizeProviderValue(value, "root");
  if (!isRecord(normalizedFields)) throw new Error("INVALID_SEMANTIC_TOOL_ARGUMENTS");
  return canonicalSemanticOutcomeSchema.parse({
    type,
    ...normalizedFields,
  });
}
