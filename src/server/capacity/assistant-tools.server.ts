import type { IbmFunctionTool } from "@/lib/ibm-ai.server";
import {
  semanticOutcomeSchema as canonicalSemanticOutcomeSchema,
  type SemanticOutcome,
} from "@/domain/capacity/assistant-semantic";

type JsonSchema = Record<string, unknown>;

const UNSAFE_TEXT_PATTERN =
  "^(?!.*\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b)(?!.*\\b[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\b)(?!.*\\b(?:[Aa][Pp][Ii][_ -]?[Kk][Ee][Yy]|[Aa][Cc][Cc][Ee][Ss][Ss][_ -]?[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Rr][Vv][Ii][Cc][Ee][_ -]?[Rr][Oo][Ll][Ee]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Jj][Ww][Tt])\\s*[:=]\\s*\\S+)(?!.*\\b[Bb][Ee][Aa][Rr][Ee][Rr]\\s+[A-Za-z0-9._~+/=-]{12,}\\b)(?!.*\\b(?:[Ss][Kk]|[Gg][Hh][PpOoUuSsRr]|[Xx][Oo][Xx][BbAaPpRrSs])[-_][A-Za-z0-9_-]{10,}\\b)(?!.*\\b(?:[Ss][Ee][Ll][Ee][Cc][Tt]\\s+\\d+|[Ss][Ee][Ll][Ee][Cc][Tt]\\s+.+\\s+[Ff][Rr][Oo][Mm]|[Ii][Nn][Ss][Ee][Rr][Tt]\\s+[Ii][Nn][Tt][Oo]|[Uu][Pp][Dd][Aa][Tt][Ee]\\s+\\S+\\s+[Ss][Ee][Tt]|[Dd][Ee][Ll][Ee][Tt][Ee]\\s+[Ff][Rr][Oo][Mm]|[Dd][Rr][Oo][Pp]\\s+[Tt][Aa][Bb][Ll][Ee]|[Aa][Ll][Tt][Ee][Rr]\\s+[Tt][Aa][Bb][Ll][Ee]|[Tt][Rr][Uu][Nn][Cc][Aa][Tt][Ee]\\s+[Tt][Aa][Bb][Ll][Ee])\\b).*$";

const roles = ["Strategy", "Data", "Engineering", "Design", "Product", "Operations"];
const levels = ["Junior", "Consultant", "Senior", "Manager", "Partner"];
const demandTypes = ["Project", "Topic", "RfP"];
const demandStatuses = ["Incoming", "Won", "In Progress", "Lost"];
const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const semanticIntentFamilies = [
  "list_consultants",
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

const safeText = (maxLength = 200): JsonSchema => ({
  type: "string",
  minLength: 1,
  maxLength,
  pattern: UNSAFE_TEXT_PATTERN,
});

const safeLongText = (maxLength = 4_000): JsonSchema => ({
  type: "string",
  maxLength,
  pattern: UNSAFE_TEXT_PATTERN,
});

const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: "null" }],
});

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

const skillsSchema: JsonSchema = {
  type: "array",
  items: safeText(100),
  maxItems: 50,
};

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[],
  options: Partial<Pick<JsonSchema, "minProperties" | "description">> = {},
): JsonSchema {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
    ...options,
  };
}

function oneOf(...schemas: JsonSchema[]): JsonSchema {
  return { oneOf: schemas };
}

function literal(value: string): JsonSchema {
  return { type: "string", enum: [value] };
}

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

const consultantRefSchema = oneOf(
  objectSchema({ kind: literal("self") }, ["kind"]),
  objectSchema({ kind: literal("current_context") }, ["kind"]),
  objectSchema({ kind: literal("name"), name: safeText() }, ["kind", "name"]),
);

const demandRefSchema = oneOf(
  objectSchema({ kind: literal("current_context") }, ["kind"]),
  objectSchema({ kind: literal("name"), name: safeText() }, ["kind", "name"]),
);

const currentContextTimeSchema = objectSchema({ kind: literal("current_context") }, ["kind"]);
const dateTimeSchema = objectSchema({ kind: literal("date"), date: dateSchema }, ["kind", "date"]);
const rangeTimeSchema = objectSchema(
  {
    kind: literal("range"),
    startDate: dateSchema,
    endDate: dateSchema,
  },
  ["kind", "startDate", "endDate"],
);
const weekOffsetTimeSchema = objectSchema(
  {
    kind: literal("week_offset"),
    weeks: integer(-104, 104),
  },
  ["kind", "weeks"],
);
const weekRangeTimeSchema = objectSchema(
  {
    kind: literal("week_range"),
    startWeekOffset: integer(-104, 104),
    durationWeeks: integer(1, 52),
  },
  ["kind", "startWeekOffset", "durationWeeks"],
);
const daysFromTodayTimeSchema = objectSchema(
  {
    kind: literal("days_from_today"),
    days: integer(-730, 730),
  },
  ["kind", "days"],
);
const relativeWeekdayTimeSchema = objectSchema(
  {
    kind: literal("relative_weekday"),
    weekday: enumSchema(weekdays),
    weekOffset: integer(-104, 104),
  },
  ["kind", "weekday"],
);

const timeRefSchema = oneOf(
  currentContextTimeSchema,
  dateTimeSchema,
  rangeTimeSchema,
  weekOffsetTimeSchema,
  weekRangeTimeSchema,
  daysFromTodayTimeSchema,
  relativeWeekdayTimeSchema,
);
const pointTimeRefSchema = oneOf(
  currentContextTimeSchema,
  dateTimeSchema,
  weekOffsetTimeSchema,
  daysFromTodayTimeSchema,
  relativeWeekdayTimeSchema,
);
const rangeRefSchema = oneOf(
  currentContextTimeSchema,
  rangeTimeSchema,
  weekOffsetTimeSchema,
  weekRangeTimeSchema,
);

const capacityFocus = ["free", "committed", "pipeline", "utilization", "breakdown", "allocations"];
const teamFocus = ["free", "committed", "pipeline", "utilization", "breakdown"];
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

const listConsultants = objectSchema(
  {
    kind: literal("listConsultants"),
    status: enumSchema(["active", "archived", "all"]),
    role: enumSchema(roles),
    level: enumSchema(levels),
    skills: objectSchema({ anyOf: skillsSchema, allOf: skillsSchema }, []),
    onDate: pointTimeRefSchema,
    includePipeline: { type: "boolean" },
    capacityFilter: enumSchema(["any", "available"]),
  },
  ["kind"],
);

const getConsultant = objectSchema(
  {
    kind: literal("getConsultant"),
    consultant: consultantRefSchema,
    onDate: pointTimeRefSchema,
    includePipeline: { type: "boolean" },
  },
  ["kind", "consultant"],
);

const listDemands = objectSchema(
  {
    kind: literal("listDemands"),
    statuses: { type: "array", items: enumSchema(demandStatuses), maxItems: 4 },
    types: { type: "array", items: enumSchema(demandTypes), maxItems: 3 },
    owner: consultantRefSchema,
    activeOn: pointTimeRefSchema,
    skills: skillsSchema,
    includeClosed: { type: "boolean" },
  },
  ["kind"],
);

const getDemand = objectSchema(
  {
    kind: literal("getDemand"),
    demand: demandRefSchema,
    onDate: pointTimeRefSchema,
    focus: enumSchema(["details", "staffing_gap"]),
  },
  ["kind", "demand"],
);

const getCapacity = objectSchema(
  {
    kind: literal("getCapacity"),
    consultant: consultantRefSchema,
    onDate: pointTimeRefSchema,
    includePipeline: { type: "boolean" },
    focus: enumSchema(capacityFocus),
  },
  ["kind", "consultant", "onDate"],
);

const getCapacityRange = objectSchema(
  {
    kind: literal("getCapacityRange"),
    consultant: consultantRefSchema,
    range: rangeRefSchema,
    includePipeline: { type: "boolean" },
    focus: enumSchema(capacityFocus),
  },
  ["kind", "consultant", "range"],
);

const getTeamOverviewRange = objectSchema(
  {
    kind: literal("getTeamOverviewRange"),
    range: rangeRefSchema,
    includePipeline: { type: "boolean" },
    role: enumSchema(roles),
    level: enumSchema(levels),
    focus: enumSchema(teamFocus),
  },
  ["kind", "range"],
);

const findAvailabilityWindows = objectSchema(
  {
    kind: literal("findAvailabilityWindows"),
    consultant: consultantRefSchema,
    range: rangeRefSchema,
    minimumFreeCapacity: integer(0, 100),
    minimumWorkingDays: integer(1, 262),
    includePipeline: { type: "boolean" },
  },
  ["kind", "range", "minimumFreeCapacity", "minimumWorkingDays"],
);

const findStaffingCandidatesRange = objectSchema(
  {
    kind: literal("findStaffingCandidatesRange"),
    demand: demandRefSchema,
    range: rangeRefSchema,
    includePipeline: { type: "boolean" },
    minimumSkillMatches: integer(0, 50),
    limit: limitSchema,
  },
  ["kind", "demand", "range"],
);

const findSuitableDemands = objectSchema(
  {
    kind: literal("findSuitableDemands"),
    consultant: consultantRefSchema,
    range: rangeRefSchema,
    includePipeline: { type: "boolean" },
    limit: limitSchema,
  },
  ["kind", "consultant", "range"],
);

const skillSupplyDemand = objectSchema(
  {
    kind: literal("skillSupplyDemand"),
    range: rangeRefSchema,
    includePipeline: { type: "boolean" },
    skill: safeText(100),
  },
  ["kind", "range"],
);

const productHelp = objectSchema(
  {
    kind: literal("productHelp"),
    topic: enumSchema(productHelpTopics),
  },
  ["kind", "topic"],
);

const findStaffingCandidates = objectSchema(
  {
    kind: literal("findStaffingCandidates"),
    demand: demandRefSchema,
    onDate: pointTimeRefSchema,
    includePipeline: { type: "boolean" },
    minimumSkillMatches: integer(0, 50),
    limit: limitSchema,
  },
  ["kind", "demand", "onDate"],
);

const getTeamOverview = objectSchema(
  {
    kind: literal("getTeamOverview"),
    onDate: pointTimeRefSchema,
    includePipeline: { type: "boolean" },
    focus: enumSchema(["overview", "overallocated"]),
  },
  ["kind", "onDate"],
);

const readActionSchema = oneOf(
  listConsultants,
  getConsultant,
  listDemands,
  getDemand,
  getCapacity,
  getCapacityRange,
  getTeamOverviewRange,
  findAvailabilityWindows,
  findStaffingCandidatesRange,
  findSuitableDemands,
  skillSupplyDemand,
  productHelp,
  findStaffingCandidates,
  getTeamOverview,
);

const consultantFieldsSchema = objectSchema(
  {
    name: safeText(),
    surname: safeText(),
    email: nullable({ type: "string", format: "email", maxLength: 320 }),
    level: enumSchema(levels),
    role: enumSchema(roles),
    skills: skillsSchema,
    workingCapacity: integer(0, 100),
  },
  ["name", "surname"],
);

const consultantPatchSchema = objectSchema(
  {
    name: safeText(),
    surname: safeText(),
    email: nullable({ type: "string", format: "email", maxLength: 320 }),
    level: enumSchema(levels),
    role: enumSchema(roles),
    skills: skillsSchema,
    workingCapacity: integer(0, 100),
    archived: { type: "boolean" },
  },
  [],
  { minProperties: 1 },
);

const demandFieldsSchema = objectSchema(
  {
    title: safeText(),
    client: safeText(),
    type: enumSchema(demandTypes),
    status: enumSchema(demandStatuses),
    description: safeLongText(),
    skills: skillsSchema,
    startDate: nullable(pointTimeRefSchema),
    endDate: nullable(pointTimeRefSchema),
    requiredCapacity: integer(0, 1000),
    owner: nullable(consultantRefSchema),
  },
  ["title"],
);

const demandPatchSchema = objectSchema(
  {
    title: safeText(),
    client: safeText(),
    type: enumSchema(demandTypes),
    status: enumSchema(demandStatuses),
    description: safeLongText(),
    skills: skillsSchema,
    startDate: nullable(pointTimeRefSchema),
    endDate: nullable(pointTimeRefSchema),
    requiredCapacity: integer(0, 1000),
    owner: nullable(consultantRefSchema),
  },
  [],
  { minProperties: 1 },
);

const writeActionSchema = oneOf(
  objectSchema({ kind: literal("createConsultant"), consultant: consultantFieldsSchema }, [
    "kind",
    "consultant",
  ]),
  objectSchema(
    {
      kind: literal("updateConsultant"),
      consultant: consultantRefSchema,
      patch: consultantPatchSchema,
    },
    ["kind", "consultant", "patch"],
  ),
  objectSchema({ kind: literal("createDemand"), demand: demandFieldsSchema }, ["kind", "demand"]),
  objectSchema(
    {
      kind: literal("updateDemand"),
      demand: demandRefSchema,
      patch: demandPatchSchema,
    },
    ["kind", "demand", "patch"],
  ),
  objectSchema(
    {
      kind: literal("setAllocation"),
      consultant: consultantRefSchema,
      demand: demandRefSchema,
      capacity: allocationSchema,
    },
    ["kind", "consultant", "demand", "capacity"],
  ),
  objectSchema(
    {
      kind: literal("removeAllocation"),
      consultant: consultantRefSchema,
      demand: demandRefSchema,
    },
    ["kind", "consultant", "demand"],
  ),
  objectSchema(
    {
      kind: literal("addAvailabilityBlock"),
      consultant: consultantRefSchema,
      startDate: pointTimeRefSchema,
      endDate: pointTimeRefSchema,
      note: safeLongText(1_000),
    },
    ["kind", "consultant", "startDate", "endDate"],
  ),
  objectSchema(
    {
      kind: literal("removeAvailabilityBlock"),
      block: objectSchema(
        {
          consultant: consultantRefSchema,
          startDate: pointTimeRefSchema,
          endDate: pointTimeRefSchema,
        },
        ["consultant", "startDate", "endDate"],
      ),
    },
    ["kind", "block"],
  ),
);

const relativeWriteOperationSchema = oneOf(
  objectSchema(
    {
      kind: literal("adjustConsultantCapacity"),
      consultant: consultantRefSchema,
      delta: integer(-100, 100),
    },
    ["kind", "consultant", "delta"],
  ),
  objectSchema(
    {
      kind: literal("adjustAllocation"),
      consultant: consultantRefSchema,
      demand: demandRefSchema,
      delta: integer(-100, 100),
    },
    ["kind", "consultant", "demand", "delta"],
  ),
  objectSchema(
    {
      kind: literal("adjustDemandCapacity"),
      demand: demandRefSchema,
      delta: integer(-1000, 1000),
    },
    ["kind", "demand", "delta"],
  ),
  objectSchema(
    {
      kind: literal("changeConsultantSkill"),
      consultant: consultantRefSchema,
      skill: safeText(100),
      operation: enumSchema(["add", "remove"]),
    },
    ["kind", "consultant", "skill", "operation"],
  ),
);

const relativeProfileProperties = {
  kind: literal("updateConsultantProfile"),
  consultant: consultantRefSchema,
  role: enumSchema(roles),
  level: enumSchema(levels),
  skill: safeText(100),
  operation: enumSchema(["add", "remove"]),
};

const relativeProfileSchema = oneOf(
  objectSchema(relativeProfileProperties, ["kind", "consultant", "role"]),
  objectSchema(relativeProfileProperties, ["kind", "consultant", "level"]),
  objectSchema(relativeProfileProperties, ["kind", "consultant", "role", "level"]),
  objectSchema(relativeProfileProperties, ["kind", "consultant", "skill", "operation"]),
  objectSchema(relativeProfileProperties, ["kind", "consultant", "role", "skill", "operation"]),
  objectSchema(relativeProfileProperties, ["kind", "consultant", "level", "skill", "operation"]),
  objectSchema(relativeProfileProperties, [
    "kind",
    "consultant",
    "role",
    "level",
    "skill",
    "operation",
  ]),
);

const completeRelativeWriteOperationSchema = oneOf(
  relativeWriteOperationSchema,
  relativeProfileSchema,
);

const safeFactsSchema = objectSchema(
  {
    consultant: consultantRefSchema,
    demand: demandRefSchema,
    time: timeRefSchema,
    name: safeText(),
    surname: safeText(),
    title: safeText(),
    client: safeText(),
    type: enumSchema(demandTypes),
    status: enumSchema(demandStatuses),
    level: enumSchema(levels),
    role: enumSchema(roles),
    skills: skillsSchema,
    capacity: integer(0, 1000),
    delta: integer(-1000, 1000),
    operation: enumSchema(["add", "remove"]),
  },
  [],
);

const readOutcomeSchema = objectSchema(
  {
    type: literal("read"),
    action: readActionSchema,
    presentation: enumSchema([
      "default",
      "available_consultants",
      "staffing_gap",
      "overallocated_consultants",
    ]),
  },
  ["type", "action"],
);

const semanticOutcomeSchema = oneOf(
  readOutcomeSchema,
  objectSchema({ type: literal("write"), action: writeActionSchema }, ["type", "action"]),
  objectSchema(
    {
      type: literal("relativeWrite"),
      operation: completeRelativeWriteOperationSchema,
      asOf: pointTimeRefSchema,
    },
    ["type", "operation", "asOf"],
  ),
  objectSchema(
    {
      type: literal("clarification"),
      intentFamily: enumSchema(semanticIntentFamilies),
      knownFacts: safeFactsSchema,
      missing: { type: "array", items: enumSchema(missingFields), minItems: 1, maxItems: 6 },
      question: safeText(240),
      reason: safeText(400),
    },
    ["type", "intentFamily", "knownFacts", "missing", "question", "reason"],
  ),
  objectSchema(
    {
      type: literal("unsupported"),
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
    },
    ["type", "reason"],
  ),
  objectSchema(
    {
      type: literal("multiple_changes"),
      changeCount: integer(2, 8),
      reason: safeText(400),
    },
    ["type", "changeCount", "reason"],
  ),
  objectSchema(
    {
      type: literal("conversation_or_help"),
      topic: enumSchema(["greeting", "thanks", "clarification", "howToUse", ...productHelpTopics]),
    },
    ["type", "topic"],
  ),
);

/** One strict native function: it emits semantics and never executes a read or write. */
export const CAPACITY_SEMANTIC_TOOL: IbmFunctionTool = {
  type: "function",
  name: "emit_capacity_semantic_outcome",
  description:
    "Emit exactly one closed Capacity Hub semantic outcome for deterministic compilation. Reads are intent only; writes and relative writes are preview candidates, never confirmations or mutations.",
  parameters: semanticOutcomeSchema,
  strict: true,
};

export const CAPACITY_ASSISTANT_TOOLS_V2: IbmFunctionTool[] = [CAPACITY_SEMANTIC_TOOL];
export const CAPACITY_SEMANTIC_TOOLS = CAPACITY_ASSISTANT_TOOLS_V2;

/** Deterministic Stage 3 boundary: only the named tool and canonical outcome are accepted. */
export function parseSemanticToolCall(name: string, rawArguments: string): SemanticOutcome {
  if (name !== CAPACITY_SEMANTIC_TOOL.name) throw new Error("UNKNOWN_SEMANTIC_TOOL");

  let value: unknown;
  try {
    value = JSON.parse(rawArguments);
  } catch {
    throw new Error("INVALID_SEMANTIC_TOOL_ARGUMENTS");
  }

  return canonicalSemanticOutcomeSchema.parse(value);
}
