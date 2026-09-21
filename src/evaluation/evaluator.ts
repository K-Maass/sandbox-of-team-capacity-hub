import {
  CAPACITY_EVAL_CORPUS,
  type CapacityEvalCase,
  type ExpectedOutcome,
  type PendingClarification,
  type SafeConversationContext,
} from "./capacity-corpus";

export type EvalProviderResult = {
  provider?: string;
  tool?: string;
  raw?: unknown;
  error?: string;
};
export type EvalConversationState = {
  safeConversationContext?: SafeConversationContext;
  pendingClarification?: PendingClarification;
};
export type SemanticActual = {
  outcome: ExpectedOutcome | "ERROR";
  intentFamily: string;
  importantArguments: Record<string, unknown>;
  authoritativeCandidates?: string[];
};
export type EvalActual = {
  intent?: unknown;
  semanticActual?: SemanticActual;
  authoritativeCandidates?: string[];
  providerResult?: EvalProviderResult;
  error?: string;
};
export type EvalCaseResult = {
  case: string;
  conversation?: { id: string; turn: number };
  expected: Pick<
    CapacityEvalCase,
    "expectedOutcome" | "expectedIntentFamily" | "expectedImportantArguments"
  >;
  providerExpectation?: {
    outcome: ExpectedOutcome;
    intentFamily: string;
    note: string;
  };
  actual: SemanticActual;
  evaluationLayer?: "provider" | "deferred_deterministic_resolution";
  pass: boolean;
  safetyCritical: boolean;
  providerResult?: EvalProviderResult;
  importantArgumentDifferences: string[];
  authoritativeCandidateDifferences: string[];
};
export type EvalReport = {
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  cases: EvalCaseResult[];
};

const EVALUATION_CREDENTIAL_LABEL =
  "(?:api[_ -]?key|access[_ -]?token|service[_ -]?role(?:[_ -]?key)?|authorization|password|secret|token|jwt)";
const EVALUATION_CREDENTIAL_ASSIGNMENT = new RegExp(
  `['"]?\\b${EVALUATION_CREDENTIAL_LABEL}['"]?\\s*[:=]\\s*['"]?[^,;\\s}"']+`,
  "gi",
);
const EVALUATION_CREDENTIAL_LITERAL = new RegExp(
  `\\b${EVALUATION_CREDENTIAL_LABEL}\\b\\s+(?:is\\s+[A-Za-z0-9._~+/=-]{8,}\\b|(?=[A-Za-z0-9._~+/=-]{8,}\\b)(?=[A-Za-z0-9._~+/=-]*[-_.~+/=0-9])[A-Za-z0-9._~+/=-]{8,}\\b)`,
  "gi",
);
const EVALUATION_JWT = /\b[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

function redactEvaluationText(value: string): string {
  return value
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [REDACTED]")
    .replace(EVALUATION_CREDENTIAL_ASSIGNMENT, "credential=[REDACTED]")
    .replace(EVALUATION_CREDENTIAL_LITERAL, "credential=[REDACTED]")
    .replace(EVALUATION_JWT, "[REDACTED]")
    .replace(/\b(?:sk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b/gi, "[REDACTED]");
}

export function redactEvaluation<T>(value: T): T {
  if (typeof value === "string") return redactEvaluationText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactEvaluation(item)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] =
        /token|password|credential|secret|api[_ -]?key|apiKey|service[_ -]?role|serviceRoleKey|access[_ -]?key|accessKey|authorization|jwt/i.test(
          key,
        )
          ? "[REDACTED]"
          : redactEvaluation(item);
    }
    return output as T;
  }
  return value;
}

function semanticFamily(kind: string): string {
  return (
    (
      {
        getCapacity: "capacity_point",
        getCapacityRange: "capacity_range",
        getTeamOverviewRange: "team_overview_range",
        getTeamOverview: "team_overview",
        getConsultant: "consultant_details",
        getDemand: "demand_details",
        listConsultants: "list_consultants",
        listConsultantsRange: "list_consultants_range",
        listDemands: "list_demands",
        findAvailabilityWindows: "availability_windows",
        findStaffingCandidatesRange: "staffing_candidates_range",
        findStaffingCandidates: "staffing_candidates",
        findSuitableDemands: "suitable_demands",
        skillSupplyDemand: "skill_supply_demand",
        productHelp: "product_help",
        createDemand: "create_demand",
        createConsultant: "create_consultant",
        setAllocation: "set_allocation",
        changeConsultantSkill: "change_consultant_skill",
        updateConsultant: "update_consultant",
        updateDemand: "update_demand",
        removeAllocation: "remove_allocation",
        addAvailabilityBlock: "add_availability_block",
        removeAvailabilityBlock: "remove_availability_block",
        adjustConsultantCapacity: "adjust_consultant_capacity",
        adjustAllocation: "adjust_allocation",
        adjustDemandCapacity: "adjust_demand_capacity",
        updateConsultantProfile: "update_consultant_profile",
      } as Record<string, string>
    )[kind] ?? kind
  );
}

function normalizeReference(value: unknown): unknown {
  if (value === "me" || value === "myself" || value === "my") return { reference: "self" };
  if (value === "context") return { reference: "context" };
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.kind === "self") return { reference: "self" };
  if (record.kind === "current_context") return { reference: "context" };
  if (record.name === "me" || record.name === "myself") return { reference: "self" };
  if (record.consultantId) return { reference: "context" };
  if (record.name) return record.name;
  if (record.title) return record.title;
  return value;
}

function flattenImportant(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      [
        "consultant",
        "demand",
        "title",
        "client",
        "name",
        "surname",
        "level",
        "role",
        "capacity",
        "requiredCapacity",
        "status",
        "type",
        "skills",
        "operation",
        "delta",
        "skill",
        "focus",
        "includePipeline",
        "capacityFilter",
        "statuses",
        "types",
        "owner",
        "activeOn",
        "minimumFreeCapacity",
        "minimumWorkingDays",
        "minimumSkillMatches",
        "limit",
        "workingCapacity",
        "archived",
        "range",
        "startDate",
        "endDate",
        "onDate",
        "reason",
        "changeCount",
        "topic",
        "field",
      ].includes(key)
    ) {
      output[key] = key === "consultant" || key === "demand" ? normalizeReference(item) : item;
    }
    if (
      ["demand", "consultant", "patch", "block"].includes(key) &&
      item &&
      typeof item === "object"
    )
      Object.assign(output, flattenImportant(item));
  }
  return output;
}

function classifyIntent(intent: unknown, state?: EvalConversationState): SemanticActual {
  if (!intent || typeof intent !== "object")
    return { outcome: "ERROR", intentFamily: "error", importantArguments: {} };
  const value = intent as Record<string, unknown>;
  const action =
    value.action && typeof value.action === "object" && !Array.isArray(value.action)
      ? (value.action as Record<string, unknown>)
      : undefined;
  const operation =
    value.operation && typeof value.operation === "object" && !Array.isArray(value.operation)
      ? (value.operation as Record<string, unknown>)
      : undefined;
  if (value.type === "unsupported")
    return {
      outcome: "UNSUPPORTED",
      intentFamily: "unsupported",
      importantArguments: { reason: value.reason },
    };
  if (value.type === "read") {
    const importantArguments = flattenImportant(action);
    if (
      action?.kind === "getTeamOverview" ||
      action?.kind === "getTeamOverviewRange" ||
      action?.kind === "listConsultants" ||
      action?.kind === "listConsultantsRange"
    )
      importantArguments.scope = "team";
    else if (
      action?.kind === "getCapacity" ||
      action?.kind === "getCapacityRange" ||
      action?.kind === "getConsultant"
    )
      importantArguments.scope = "consultant";
    return {
      outcome: "READ",
      intentFamily: semanticFamily(String(action?.kind ?? "read")),
      importantArguments,
    };
  }
  if (value.type === "relativeWrite")
    return {
      outcome: "RELATIVE_WRITE",
      intentFamily: semanticFamily(String(operation?.kind ?? "relative_write")),
      importantArguments: flattenImportant(operation),
    };
  if (value.type === "write")
    return {
      outcome: "WRITE",
      intentFamily: semanticFamily(String(action?.kind ?? "write")),
      importantArguments: flattenImportant(action),
    };
  if (value.type === "clarification") {
    const sourceFamily = semanticFamily(
      String(value.sourceFamily ?? value.intentFamily ?? "unknown"),
    );
    const field = String(value.field ?? state?.pendingClarification?.field ?? "unknown");
    return {
      outcome: "CLARIFICATION",
      intentFamily: `clarification_${sourceFamily}_${field}`,
      importantArguments: { field, ...flattenImportant(value.knownFacts) },
    };
  }
  if (value.type === "multiple_changes")
    return {
      outcome: "MULTIPLE_CHANGES",
      intentFamily: "multiple_changes",
      importantArguments: { changeCount: value.changeCount, reason: value.reason },
    };
  if (value.type === "conversation_or_help")
    return {
      outcome: "CONVERSATION_OR_HELP",
      intentFamily: value.topic === "clarification" ? "clarification_help" : "conversation_or_help",
      importantArguments: { field: value.topic === "clarification" ? "consultant" : undefined },
    };
  return { outcome: "ERROR", intentFamily: "unknown", importantArguments: {} };
}

function dateForConcept(concept: string): string | null {
  return (
    (
      {
        today: "2026-09-15",
        tomorrow: "2026-09-16",
        in_2_days: "2026-09-17",
        next_monday: "2026-09-21",
        next_tuesday: "2026-09-22",
        next_friday: "2026-09-25",
        in_7_days: "2026-09-22",
        sep_30: "2026-09-30",
        next_month: "2026-10-01",
      } as Record<string, string>
    )[concept] ?? null
  );
}

function rangeForConcept(concept: string): { startDate: string; endDate: string } | null {
  return (
    (
      {
        this_week: { startDate: "2026-09-14", endDate: "2026-09-18" },
        next_week: { startDate: "2026-09-21", endDate: "2026-09-25" },
        next_two_weeks: { startDate: "2026-09-21", endDate: "2026-10-02" },
        week_after_next: { startDate: "2026-09-28", endDate: "2026-10-02" },
        next_three_weeks: { startDate: "2026-09-21", endDate: "2026-10-09" },
        next_month: { startDate: "2026-10-01", endDate: "2026-10-31" },
        october: { startDate: "2026-10-01", endDate: "2026-10-31" },
        end_sep: { startDate: "2026-09-28", endDate: "2026-09-30" },
      } as Record<string, { startDate: string; endDate: string }>
    )[concept] ?? null
  );
}

function semanticEqual(
  expected: unknown,
  actual: unknown,
  key: string,
  context?: EvalConversationState,
): boolean {
  const actualRecord =
    actual && typeof actual === "object" && !Array.isArray(actual)
      ? (actual as Record<string, unknown>)
      : undefined;
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const value = expected as Record<string, unknown>;
    if (typeof value.reference === "string") {
      if (actualRecord?.kind === (value.reference === "self" ? "self" : "current_context"))
        return true;
      if (
        value.reference === "context" &&
        context?.safeConversationContext?.range &&
        actualRecord?.kind === "range" &&
        actualRecord.startDate === context.safeConversationContext.range.startDate &&
        actualRecord.endDate === context.safeConversationContext.range.endDate
      )
        return true;
      return JSON.stringify(actual) === JSON.stringify(value);
    }
    if (typeof value.timeConcept === "string") {
      if (actualRecord?.timeConcept === value.timeConcept) return true;
      const expectedRange = rangeForConcept(value.timeConcept);
      if (
        expectedRange &&
        actualRecord?.startDate === expectedRange.startDate &&
        actualRecord.endDate === expectedRange.endDate
      )
        return true;
      if (value.timeConcept === "next_week")
        return (
          actual === "2026-09-21" ||
          actualRecord?.startDate === "2026-09-21" ||
          (actualRecord?.kind === "week_offset" && actualRecord.weeks === 1) ||
          (actualRecord?.kind === "week_range" &&
            actualRecord.startWeekOffset === 1 &&
            actualRecord.durationWeeks === 1)
        );
      if (value.timeConcept === "next_two_weeks")
        return (
          actualRecord?.startDate === "2026-09-21" ||
          (actualRecord?.kind === "week_range" &&
            actualRecord.startWeekOffset === 1 &&
            actualRecord.durationWeeks === 2)
        );
      if (value.timeConcept === "next_monday")
        return (
          actualRecord?.kind === "relative_weekday" &&
          actualRecord.weekday === "monday" &&
          (actualRecord.weekOffset === 0 || actualRecord.weekOffset === 1)
        );
      if (value.timeConcept === "next_tuesday")
        return (
          actualRecord?.kind === "relative_weekday" &&
          actualRecord.weekday === "tuesday" &&
          (actualRecord.weekOffset === 0 || actualRecord.weekOffset === 1)
        );
      if (value.timeConcept === "next_friday")
        return (
          actualRecord?.kind === "relative_weekday" &&
          actualRecord.weekday === "friday" &&
          (actualRecord.weekOffset === 0 || actualRecord.weekOffset === 1)
        );
      if (value.timeConcept === "tomorrow")
        return actualRecord?.kind === "days_from_today" && actualRecord.days === 1;
      if (value.timeConcept === "in_2_days")
        return actualRecord?.kind === "days_from_today" && actualRecord.days === 2;
      if (value.timeConcept === "in_7_days")
        return actualRecord?.kind === "days_from_today" && actualRecord.days === 7;
      return actual === dateForConcept(value.timeConcept);
    }
    if (typeof value.minimum === "number") {
      if (typeof actual === "number") return actual >= value.minimum;
      return typeof actualRecord?.minimum === "number" && actualRecord.minimum >= value.minimum;
    }
  }
  if (key === "consultant" && expected === "context")
    return (
      actualRecord?.kind === "current_context" ||
      actual === context?.safeConversationContext?.consultantLabel ||
      JSON.stringify(actual) === JSON.stringify({ reference: "context" })
    );
  if (key === "focus" && expected === "staffing" && actual === "staffing_gap") return true;
  return JSON.stringify(actual ?? null).toLowerCase() === JSON.stringify(expected).toLowerCase();
}

function matches(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  context?: EvalConversationState,
): string[] {
  const differences: string[] = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue =
      key === "range"
        ? (actual.range ?? { startDate: actual.startDate, endDate: actual.endDate })
        : actual[key];
    if (!semanticEqual(expectedValue, actualValue, key, context))
      differences.push(
        `${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
      );
  }
  return differences;
}

export async function evaluateCorpus(
  cases: readonly CapacityEvalCase[] = CAPACITY_EVAL_CORPUS,
  interpret: (
    testCase: CapacityEvalCase,
    state: EvalConversationState,
  ) => Promise<EvalActual> | EvalActual,
): Promise<EvalReport> {
  const results: EvalCaseResult[] = [];
  const states = new Map<string, EvalConversationState>();
  for (const testCase of cases) {
    const conversationId = testCase.conversationId ?? testCase.id;
    const state: EvalConversationState = {
      ...(states.get(conversationId) ?? {}),
      ...(testCase.safeConversationContext
        ? { safeConversationContext: testCase.safeConversationContext }
        : {}),
      ...(testCase.pendingClarification
        ? { pendingClarification: testCase.pendingClarification }
        : {}),
    };
    let actual: EvalActual;
    try {
      actual = await interpret(testCase, state);
    } catch (error) {
      actual = { error: error instanceof Error ? error.message : String(error) };
    }
    const classified = actual.error
      ? { outcome: "ERROR" as const, intentFamily: "error", importantArguments: {} }
      : (actual.semanticActual ?? classifyIntent(actual.intent, state));
    const differences = matches(
      testCase.expectedImportantArguments,
      classified.importantArguments,
      state,
    );
    const expectedCandidates = testCase.pendingClarification?.authoritativeCandidates ?? [];
    const actualCandidates =
      actual.authoritativeCandidates ?? classified.authoritativeCandidates ?? [];
    const authoritativeCandidateDifferences = testCase.deferredProviderResolution
      ? []
      : JSON.stringify(expectedCandidates) === JSON.stringify(actualCandidates)
        ? []
        : expectedCandidates.length > 0
          ? [
              `authoritativeCandidates: expected ${JSON.stringify(expectedCandidates)}, got ${JSON.stringify(actualCandidates)}`,
            ]
          : [];
    const providerExpectation = testCase.deferredProviderResolution;
    const expectedOutcome = providerExpectation?.providerOutcome ?? testCase.expectedOutcome;
    const expectedIntentFamily =
      providerExpectation?.providerIntentFamily ?? testCase.expectedIntentFamily;
    results.push({
      case: testCase.id,
      conversation: testCase.conversationId
        ? { id: testCase.conversationId, turn: testCase.conversationTurn ?? 1 }
        : undefined,
      expected: {
        expectedOutcome: testCase.expectedOutcome,
        expectedIntentFamily: testCase.expectedIntentFamily,
        expectedImportantArguments: testCase.expectedImportantArguments,
      },
      providerExpectation: providerExpectation
        ? {
            outcome: providerExpectation.providerOutcome,
            intentFamily: providerExpectation.providerIntentFamily,
            note: providerExpectation.note,
          }
        : undefined,
      actual: classified,
      evaluationLayer: providerExpectation ? "deferred_deterministic_resolution" : "provider",
      pass:
        classified.outcome === expectedOutcome &&
        classified.intentFamily === expectedIntentFamily &&
        differences.length === 0 &&
        authoritativeCandidateDifferences.length === 0,
      safetyCritical: testCase.safetyCritical,
      providerResult: redactEvaluation(actual.providerResult),
      importantArgumentDifferences: differences,
      authoritativeCandidateDifferences,
    });
    states.set(conversationId, {
      safeConversationContext: testCase.safeConversationContext,
      pendingClarification: testCase.pendingClarification,
    });
  }
  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((item) => item.pass).length,
    failed: results.filter((item) => !item.pass).length,
    cases: results,
  };
  return redactEvaluation(report);
}
