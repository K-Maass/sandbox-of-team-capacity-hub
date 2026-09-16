import { z } from "zod";

import type { ConversationContext } from "@/domain/capacity/assistant";
import {
  safeSemanticFactsSchema,
  safeSemanticTextSchema,
  semanticIntentFamilySchema,
  semanticMissingFieldSchema,
} from "@/domain/capacity/assistant-semantic";
import { calendarDateSchema } from "@/domain/capacity/assistant-context";

const safeLabelSchema = safeSemanticTextSchema(200);
const safeRangeLabelSchema = safeSemanticTextSchema(120, 0);
const safeScopeSchema = z.enum(["consultant", "team", "demand"]);
const safeFocusSchema = z.enum([
  "free",
  "committed",
  "pipeline",
  "utilization",
  "breakdown",
  "allocations",
  "staffing",
  "availability",
  "skills",
]);
const safeExplainFocusSchema = z.enum([
  "free",
  "committed",
  "pipeline",
  "utilization",
  "allocations",
]);
const safeClarificationFieldSchema = z.enum([
  "block",
  "block.consultant",
  "consultant",
  "demand",
  "demand.owner",
  "owner",
  "patch.owner",
]);

type UnknownRecord = Record<string, unknown>;

export type SafeSemanticPromptContext = {
  scope?: "consultant" | "team" | "demand";
  consultantLabel?: string;
  demandLabel?: string;
  range?: { startDate: string; endDate: string; label?: string };
  includePipeline?: boolean;
  focus?: z.infer<typeof safeFocusSchema>;
  explainFocus?: z.infer<typeof safeExplainFocusSchema>;
  pendingClarification?: {
    field?: string;
    intentFamily?: string;
    knownFacts?: z.infer<typeof safeSemanticFactsSchema>;
    missing?: string[];
  };
};

export type SafeSemanticPromptInput = {
  context?: ConversationContext | UnknownRecord;
  pendingClarification?: unknown;
  pendingSemanticFacts?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString<T extends string>(value: unknown, schema: z.ZodType<T>): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function safeDate(value: unknown): string | undefined {
  return safeString(value, calendarDateSchema);
}

function addIfPresent<T>(target: UnknownRecord, key: string, value: T | undefined): void {
  if (value !== undefined) target[key] = value;
}

function projectRange(value: unknown): SafeSemanticPromptContext["range"] | undefined {
  if (!isRecord(value)) return undefined;
  const startDate = safeDate(value.startDate);
  const endDate = safeDate(value.endDate);
  if (!startDate || !endDate || endDate < startDate) return undefined;
  const label = safeString(value.label, safeRangeLabelSchema);
  return label === undefined ? { startDate, endDate } : { startDate, endDate, label };
}

function projectPending(value: unknown): SafeSemanticPromptContext["pendingClarification"] {
  if (!isRecord(value)) return undefined;

  const output: NonNullable<SafeSemanticPromptContext["pendingClarification"]> = {};
  const field = safeString(value.field, safeClarificationFieldSchema);
  const intentFamily = safeString(value.intentFamily, semanticIntentFamilySchema);
  const missing: string[] = [];
  if (Array.isArray(value.missing)) {
    for (const item of value.missing) {
      const parsed = safeString(item, semanticMissingFieldSchema);
      if (parsed !== undefined && missing.length < 6) missing.push(parsed);
    }
  }
  const knownFacts = safeSemanticFactsSchema.safeParse(value.knownFacts);

  addIfPresent(output, "field", field);
  addIfPresent(output, "intentFamily", intentFamily);
  if (knownFacts.success) output.knownFacts = knownFacts.data;
  if (missing.length > 0) output.missing = missing;

  return Object.keys(output).length > 0 ? output : undefined;
}

/**
 * Project conversation state into the only context Luna needs. IDs, rows,
 * authoritative candidates, credentials, and unknown fields are intentionally
 * never read from the input object.
 */
export function projectSafeSemanticContext(
  input: SafeSemanticPromptInput = {},
): SafeSemanticPromptContext {
  const context = isRecord(input.context) ? input.context : undefined;
  const output: SafeSemanticPromptContext = {};

  const scope = safeString(context?.scope, safeScopeSchema);
  const consultant = isRecord(context?.lastConsultant)
    ? safeString(context.lastConsultant.label, safeLabelSchema)
    : undefined;
  const demand = isRecord(context?.lastDemand)
    ? safeString(context.lastDemand.label, safeLabelSchema)
    : undefined;
  const range = projectRange(context?.lastRange);
  const focus = safeString(context?.lastFocus, safeFocusSchema);
  const explainFocus = safeString(context?.explainFocus, safeExplainFocusSchema);

  if (scope) output.scope = scope;
  if (consultant) output.consultantLabel = consultant;
  if (demand) output.demandLabel = demand;
  if (range) output.range = range;
  if (typeof context?.includePipeline === "boolean") {
    output.includePipeline = context.includePipeline;
  }
  if (focus) output.focus = focus;
  if (explainFocus) output.explainFocus = explainFocus;

  const pending = projectPending(input.pendingClarification ?? input.pendingSemanticFacts);
  if (pending) output.pendingClarification = pending;

  return output;
}

function currentDateManifest(currentDate: string, currentTime?: string, timeZone?: string): string {
  const parsedDate = calendarDateSchema.parse(currentDate);
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${parsedDate}T00:00:00Z`));
  const normalizedTime =
    typeof currentTime === "string" &&
    /^\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(currentTime)
      ? currentTime
      : "not supplied";
  const normalizedZone =
    typeof timeZone === "string" && /^[A-Za-z0-9_./+-]{1,80}$/.test(timeZone)
      ? timeZone
      : "runtime-local";
  return `today=${parsedDate}; weekday=${weekday}; current_time=${normalizedTime}; timezone=${normalizedZone}`;
}

const MAX_SEMANTIC_PROMPT_CHARS = 12_000;

const CORE_INSTRUCTIONS = `
Interpret one Capacity Hub user request and emit exactly one call to the supplied
emit_capacity_semantic_outcome function. Never answer with prose and never call
more than one tool. The result is semantic input for a deterministic compiler:
it does not read the database, execute SQL, reveal data, confirm a write, or
perform a mutation. Never invent IDs, rows, tokens, credentials, candidate
authority, query objects, or confirmation state.

Use only the closed vocabulary in the schema. Resolve meaning, not records:
use {kind:self} for the user, {kind:current_context} only when the safe context
supports it, and {kind:name,name:...} for a human/project label. Preserve names,
titles, clients, skills, and known facts exactly when they are supplied. An
ambiguous name becomes clarification; do not choose among candidates.

Time is semantic, inclusive, and bounded. Use an exact date only when the user
gave one. Use current_context for an explicit continuation. Represent relative
time with week_offset, week_range, days_from_today, or relative_weekday; do not
perform calendar arithmetic or turn “in two weeks” into an invented date.
Point capacity needs point time; range capacity needs a bounded range. Use the
compiler's current date manifest, not your own date authority.

For demand creation, the established defaults are type=Project, status=Incoming,
and requiredCapacity=100 when omitted. Do not invent a client, dates, skills, or
owner. For consultant creation, preserve only stated fields and leave permitted
Phase 2 defaults to the compiler; ask for required information rather than
inventing a surname, level, or role.

Clarification preserves every safe known fact and lists only closed missing
fields. Ask one focused question. Pending semantic facts are context, not
authority. A request with two or more requested changes emits multiple_changes
and performs zero actions. Partial-day availability, date-specific allocation,
temporary capacity schedules, undo/history, destructive requests, security or
credential requests, SQL, and unrelated work emit unsupported with the closest
closed reason. “API Key Migration” is an ordinary business title unless the
user asks for a credential value.

Useful failure-boundary examples:
- “Create Nestle in the pipeline.” -> write/createDemand, title Nestle, with the
  demand defaults above.
- “Add Anna to the team.” -> clarification; preserve Anna and ask for missing
  consultant profile fields. “What do you need to know?” -> conversation_or_help
  with topic clarification, not a new write.
- “Management skills” -> conversation_or_help/howToUse or product help; do not
  invent a consultant update.
- “Show the team's capacity over the next two weeks.” -> read/team overview
  with week_range, startWeekOffset=1, durationWeeks=2.
- “What's already taken?”, “And what about the pipeline?”, “Why?”, “Which
  projects?”, then “What about Maya?” -> use current_context and the requested
  focus; preserve the range while changing the named consultant only when Maya
  is unambiguous.
- “How is Phoenix staffed?” -> read/demand details. If Phoenix resolves to more
  than one demand, emit clarification and preserve the title and focus.
- “Make Maya unavailable tomorrow afternoon.” -> unsupported/partial_day_availability.
- “Undo that.” -> unsupported/history_undo_unavailable.
- “Allocate Maya 50% to Phoenix and create Apollo.” -> multiple_changes with zero
  action.
- “Create API Key Migration in the pipeline.” -> write/createDemand; do not treat
  the business title as a credential request.
`.trim();

export function buildCapacityAssistantPrompt(options: {
  currentDate: string;
  currentTime?: string;
  timeZone?: string;
  context?: ConversationContext | UnknownRecord;
  pendingClarification?: unknown;
  pendingSemanticFacts?: unknown;
}): string {
  const safeContext = projectSafeSemanticContext(options);
  const contextJson = JSON.stringify(safeContext);
  const prompt = [
    CORE_INSTRUCTIONS,
    `Current date/time manifest: ${currentDateManifest(options.currentDate, options.currentTime, options.timeZone)}`,
    `Safe semantic context (non-authoritative labels, dates, focus, and pending facts only): ${contextJson}`,
    `Keep the serialized instruction bounded to ${MAX_SEMANTIC_PROMPT_CHARS} characters or less; do not echo user secrets.`,
  ].join("\n\n");

  if (prompt.length > MAX_SEMANTIC_PROMPT_CHARS)
    throw new Error("CAPACITY_SEMANTIC_PROMPT_TOO_LARGE");
  return prompt;
}
