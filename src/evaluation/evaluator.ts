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
  actual: SemanticActual;
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

const SECRET =
  /(bearer\s+[^\s"']+|(?:api|access|service[-_ ]?role)[-_ ]?key\s*[:=]\s*[^\s"']+|jwt\s*[:=]\s*[^\s"']+|password\s*[:=]\s*[^\s"']+|secret\s*[:=]\s*[^\s"']+)/gi;

export function redactEvaluation<T>(value: T): T {
  if (typeof value === "string") return value.replace(SECRET, "[REDACTED]") as T;
  if (Array.isArray(value)) return value.map((item) => redactEvaluation(item)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] =
        /token|password|credential|secret|apiKey|serviceRoleKey|accessKey|authorization/i.test(key)
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
        createDemand: "create_demand",
        createConsultant: "create_consultant",
        setAllocation: "set_allocation",
        changeConsultantSkill: "change_consultant_skill",
      } as Record<string, string>
    )[kind] ?? kind
  );
}

function normalizeReference(value: unknown): unknown {
  if (value === "me" || value === "myself" || value === "my") return { reference: "self" };
  if (value === "context") return { reference: "context" };
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
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
        "focus",
        "includePipeline",
        "startDate",
        "endDate",
        "onDate",
        "reason",
      ].includes(key)
    ) {
      output[key] = key === "consultant" || key === "demand" ? normalizeReference(item) : item;
    }
    if ((key === "demand" || key === "consultant") && item && typeof item === "object")
      Object.assign(output, flattenImportant(item));
  }
  return output;
}

function classifyIntent(intent: unknown): SemanticActual {
  if (!intent || typeof intent !== "object")
    return { outcome: "ERROR", intentFamily: "error", importantArguments: {} };
  const value = intent as Record<string, any>;
  if (value.type === "unsupported")
    return {
      outcome: "UNSUPPORTED",
      intentFamily: "unsupported",
      importantArguments: { reason: value.reason },
    };
  if (value.type === "read")
    return {
      outcome: "READ",
      intentFamily: semanticFamily(String(value.action?.kind ?? "read")),
      importantArguments: flattenImportant(value.action),
    };
  if (value.type === "relativeWrite")
    return {
      outcome: "RELATIVE_WRITE",
      intentFamily: String(value.operation?.kind ?? "relative_write"),
      importantArguments: flattenImportant(value.operation),
    };
  if (value.type === "write")
    return {
      outcome: "WRITE",
      intentFamily: semanticFamily(String(value.action?.kind ?? "write")),
      importantArguments: flattenImportant(value.action),
    };
  if (value.type === "clarification") {
    const sourceFamily = semanticFamily(
      String(value.sourceFamily ?? value.intentFamily ?? "unknown"),
    );
    const field = String(value.field ?? "unknown");
    return {
      outcome: "CLARIFICATION",
      intentFamily: `clarification_${sourceFamily}_${field}`,
      importantArguments: { field: value.field },
    };
  }
  return { outcome: "ERROR", intentFamily: "unknown", importantArguments: {} };
}

function dateForConcept(concept: string): string | null {
  return (
    (
      { today: "2026-09-15", next_monday: "2026-09-21", next_month: "2026-10-01" } as Record<
        string,
        string
      >
    )[concept] ?? null
  );
}

function rangeForConcept(concept: string): { startDate: string; endDate: string } | null {
  return (
    (
      {
        next_week: { startDate: "2026-09-21", endDate: "2026-09-25" },
        next_two_weeks: { startDate: "2026-09-21", endDate: "2026-10-02" },
        next_month: { startDate: "2026-10-01", endDate: "2026-10-31" },
      } as Record<string, { startDate: string; endDate: string }>
    )[concept] ?? null
  );
}

function semanticEqual(expected: unknown, actual: unknown, key: string): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const value = expected as Record<string, unknown>;
    if (typeof value.reference === "string")
      return JSON.stringify(actual) === JSON.stringify(value);
    if (typeof value.timeConcept === "string") {
      if ((actual as any)?.timeConcept === value.timeConcept) return true;
      if (value.timeConcept === "next_week")
        return actual === "2026-09-21" || (actual as any)?.startDate === "2026-09-21";
      if (value.timeConcept === "next_two_weeks")
        return (actual as any)?.startDate === "2026-09-21";
      return actual === dateForConcept(value.timeConcept);
    }
    if (typeof value.minimum === "number") {
      if (typeof actual === "number") return actual >= value.minimum;
      return (
        typeof (actual as any)?.minimum === "number" && (actual as any).minimum >= value.minimum
      );
    }
  }
  if (key === "consultant" && expected === "context")
    return JSON.stringify(actual) === JSON.stringify({ reference: "context" });
  return JSON.stringify(actual ?? null).toLowerCase() === JSON.stringify(expected).toLowerCase();
}

function matches(expected: Record<string, unknown>, actual: Record<string, unknown>): string[] {
  const differences: string[] = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (
      key === "range" &&
      expectedValue &&
      typeof expectedValue === "object" &&
      typeof (expectedValue as Record<string, unknown>).timeConcept === "string"
    ) {
      const expectedRange = rangeForConcept(
        String((expectedValue as Record<string, unknown>).timeConcept),
      );
      const actualRange = (actual.range ?? {
        startDate: actual.startDate,
        endDate: actual.endDate,
      }) as Record<string, unknown>;
      if (actualRange.timeConcept === (expectedValue as Record<string, unknown>).timeConcept) {
        continue;
      }
      if (
        !expectedRange ||
        actualRange.startDate !== expectedRange.startDate ||
        actualRange.endDate !== expectedRange.endDate
      ) {
        differences.push(
          `${key}: expected ${JSON.stringify(expectedRange)}, got ${JSON.stringify(actualRange)}`,
        );
      }
      continue;
    }
    if (!semanticEqual(expectedValue, actual[key], key))
      differences.push(
        `${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual[key])}`,
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
    const state = states.get(conversationId) ?? {};
    let actual: EvalActual;
    try {
      actual = await interpret(testCase, state);
    } catch (error) {
      actual = { error: error instanceof Error ? error.message : String(error) };
    }
    const classified = actual.error
      ? { outcome: "ERROR" as const, intentFamily: "error", importantArguments: {} }
      : (actual.semanticActual ?? classifyIntent(actual.intent));
    const differences = matches(testCase.expectedImportantArguments, classified.importantArguments);
    const expectedCandidates = testCase.pendingClarification?.authoritativeCandidates ?? [];
    const actualCandidates =
      actual.authoritativeCandidates ?? classified.authoritativeCandidates ?? [];
    const authoritativeCandidateDifferences =
      JSON.stringify(expectedCandidates) === JSON.stringify(actualCandidates)
        ? []
        : expectedCandidates.length > 0
          ? [
              `authoritativeCandidates: expected ${JSON.stringify(expectedCandidates)}, got ${JSON.stringify(actualCandidates)}`,
            ]
          : [];
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
      actual: classified,
      pass:
        classified.outcome === testCase.expectedOutcome &&
        classified.intentFamily === testCase.expectedIntentFamily &&
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
