// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";
import { CAPACITY_EVAL_CORPUS, REQUIRED_EVAL_FAMILIES } from "./capacity-corpus";
import { evaluateCorpus, redactEvaluation } from "./evaluator";
import { createLegacyV1Adapter, toLegacyV1AdapterInput } from "./legacy-v1-adapter";
import { createStateAwareProviderAdapter } from "./state-aware-provider-adapter";

describe("Stage 1 Capacity Hub evaluation corpus", () => {
  test("covers every mandatory family with executable cases and safe sequential context", () => {
    const familyCases: Record<string, (item: (typeof CAPACITY_EVAL_CORPUS)[number]) => boolean> = {
      "capacity reads": (item) => item.expectedOutcome === "READ" && item.tags.includes("capacity"),
      "follow-ups": (item) => item.tags.includes("follow-up") && Boolean(item.conversationId),
      scope: (item) => item.tags.includes("scope"),
      "demand creation": (item) => item.expectedIntentFamily === "create_demand",
      "consultant creation": (item) => item.expectedIntentFamily === "create_consultant",
      "self skills": (item) =>
        item.expectedIntentFamily === "change_consultant_skill" &&
        item.expectedOutcome === "RELATIVE_WRITE",
      allocations: (item) => item.expectedIntentFamily === "set_allocation",
      ambiguity: (item) =>
        item.expectedOutcome === "CLARIFICATION" &&
        Boolean(item.pendingClarification?.authoritativeCandidates),
      "unsupported requests": (item) => item.expectedOutcome === "UNSUPPORTED",
      "compound requests": (item) => item.expectedOutcome === "MULTIPLE_CHANGES",
      "security/privacy": (item) => item.tags.includes("security"),
      "legitimate titles": (item) => item.tags.includes("legitimate-title"),
      "topic supersession": (item) => item.tags.includes("supersession"),
      "context invalidation": (item) => item.tags.includes("invalidation"),
      "natural paraphrases": (item) => item.tags.some((tag) => tag.startsWith("paraphrase")),
    };
    for (const family of REQUIRED_EVAL_FAMILIES)
      expect(CAPACITY_EVAL_CORPUS.some(familyCases[family])).toBe(true);
    expect(
      CAPACITY_EVAL_CORPUS.filter((item) => item.conversationId).length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      CAPACITY_EVAL_CORPUS.find((item) => item.id === "consultant-clarification-followup")
        ?.pendingClarification,
    ).toBeDefined();
    expect(CAPACITY_EVAL_CORPUS.length).toBeGreaterThanOrEqual(35);
    for (const item of CAPACITY_EVAL_CORPUS) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.userMessage.length).toBeGreaterThan(0);
      expect(item.expectedImportantArguments).toBeDefined();
      expect(JSON.stringify(item)).not.toMatch(/00000000-0000|eyJ[a-zA-Z0-9_-]+\./);
    }
  });

  test("matches semantic expected outcomes and arguments", async () => {
    const report = await evaluateCorpus(CAPACITY_EVAL_CORPUS.slice(0, 2), (item) => ({
      intent:
        item.id === "capacity-karim"
          ? { type: "read", action: { kind: "capacity_point", consultant: "Karim", focus: "free" } }
          : undefined,
      semanticActual:
        item.id === "capacity-self"
          ? {
              outcome: "READ",
              intentFamily: "capacity_range",
              importantArguments: {
                consultant: { reference: "self" },
                range: { timeConcept: "next_week" },
                focus: "free",
              },
            }
          : undefined,
    }));
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
  });

  test("does not let expected values become actuals", async () => {
    const original = CAPACITY_EVAL_CORPUS.find((item) => item.id === "capacity-karim")!;
    const altered = {
      ...original,
      expectedImportantArguments: { consultant: "Not Karim", focus: "free" },
    };
    const report = await evaluateCorpus([altered], () => ({
      semanticActual: {
        outcome: "READ",
        intentFamily: "capacity_point",
        importantArguments: { consultant: "Karim", focus: "free" },
      },
    }));
    expect(report.failed).toBe(1);
    expect(report.cases[0].importantArgumentDifferences[0]).toContain("Not Karim");
  });

  test("compares authoritative ambiguity labels separately from language semantics", async () => {
    const ambiguity = CAPACITY_EVAL_CORPUS.find((item) => item.id === "ambiguity-alex")!;
    const good = await evaluateCorpus([ambiguity], () => ({
      semanticActual: {
        outcome: "CLARIFICATION",
        intentFamily: "clarification_set_allocation_consultant",
        importantArguments: ambiguity.expectedImportantArguments,
        authoritativeCandidates: ["Alex Meyer", "Alex Smith"],
      },
    }));
    const bad = await evaluateCorpus([ambiguity], () => ({
      semanticActual: {
        outcome: "CLARIFICATION",
        intentFamily: "clarification_set_allocation_consultant",
        importantArguments: ambiguity.expectedImportantArguments,
        authoritativeCandidates: ["Alex Meyer", "Alex Jones"],
      },
    }));
    expect(good.passed).toBe(1);
    expect(bad.failed).toBe(1);
    expect(bad.cases[0].authoritativeCandidateDifferences).toHaveLength(1);
  });

  test("passes safe context and pending clarification through the live adapter boundary", async () => {
    const testCase = CAPACITY_EVAL_CORPUS.find(
      (item) => item.id === "consultant-clarification-followup",
    )!;
    const seen: Record<string, unknown>[] = [];
    const adapter = createLegacyV1Adapter(async () => ({
      type: "unsupported",
      reason: "missing_information",
    }));
    const state = {
      safeConversationContext: { scope: "consultant" as const, consultantLabel: "Anna" },
      pendingClarification: { field: "owner" as const, requestedValues: { missing: ["role"] } },
    };
    const actual = await adapter(toLegacyV1AdapterInput(testCase, state));
    seen.push(actual.providerResult?.raw as Record<string, unknown>);
    expect(seen[0].boundedContext).toMatchObject({ consultantLabel: "Anna" });
    expect(seen[0].pendingClarification).toMatchObject({ field: "owner" });
    expect(JSON.stringify(seen[0])).not.toContain("Alex Meyer");
  });

  test("serializes safe state into the strict provider request without authority or secrets", async () => {
    const testCase = CAPACITY_EVAL_CORPUS.find((item) => item.id === "followup-taken")!;
    let serializedRequest = "";
    const adapter = createStateAwareProviderAdapter(async (options) => {
      serializedRequest = JSON.stringify({
        instructions: options.instructions,
        input: options.input,
      });
      return {
        name: "read_get_capacity",
        arguments: JSON.stringify({
          consultant: "me",
          onDate: "2026-09-21",
          includePipeline: false,
          focus: "committed",
        }),
      };
    });
    await adapter({
      testCase,
      state: {
        safeConversationContext: {
          scope: "consultant",
          consultantLabel: "Karim Maass",
          range: { startDate: "2026-09-21", endDate: "2026-09-25", label: "next week" },
        },
        pendingClarification: {
          field: "consultant",
          requestedValues: { name: "Karim" },
          authoritativeCandidates: ["Alex Meyer", "Alex Smith"],
        },
      },
    });
    expect(serializedRequest).toContain("Karim Maass");
    expect(serializedRequest).toContain("next week");
    expect(serializedRequest).toContain("requestedValues");
    expect(serializedRequest).not.toContain("Alex Meyer");
    expect(serializedRequest).not.toContain("00000000-0000");
    expect(serializedRequest).not.toContain("Bearer secret");
  });

  test("sanitizes direct labels before provider serialization", async () => {
    const testCase = CAPACITY_EVAL_CORPUS.find((item) => item.id === "capacity-karim")!;
    const requests: string[] = [];
    const adapter = createStateAwareProviderAdapter(async (options) => {
      requests.push(options.instructions);
      return {
        name: "read_get_capacity",
        arguments: JSON.stringify({
          consultant: "Karim",
          onDate: "2026-09-15",
          includePipeline: false,
          focus: "free",
        }),
      };
    });
    await adapter({
      testCase,
      state: {
        safeConversationContext: {
          scope: "consultant",
          consultantLabel:
            "Bad 00000000-0000-4000-8000-000000000001 bearer leaked-token API key=leaked secret=leaked",
          demandLabel: "Bearer demand-token apiKey=leaked secret=leaked",
        },
      },
    });
    expect(requests[0]).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(requests[0]).not.toContain("leaked-token");
    expect(requests[0]).not.toContain("apiKey=leaked");
    expect(requests[0]).not.toContain("secret=leaked");

    await adapter({
      testCase,
      state: { safeConversationContext: { scope: "consultant", consultantLabel: "Karim Maass" } },
    });
    expect(requests[1]).toContain("Karim Maass");
  });

  test("drops deeply nested semantic values instead of passing them through", async () => {
    const testCase = CAPACITY_EVAL_CORPUS.find((item) => item.id === "capacity-karim")!;
    let instructions = "";
    const adapter = createStateAwareProviderAdapter(async (options) => {
      instructions = options.instructions;
      return {
        name: "read_get_capacity",
        arguments: JSON.stringify({
          consultant: "Karim",
          onDate: "2026-09-15",
          includePipeline: false,
          focus: "free",
        }),
      };
    });
    await adapter({
      testCase,
      state: {
        safeConversationContext: { scope: "consultant", consultantLabel: "Karim Maass" },
        pendingClarification: {
          field: "consultant",
          requestedValues: {
            level1: {
              level2: {
                level3: {
                  level4: { secret: "nested-secret", uuid: "00000000-0000-4000-8000-000000000001" },
                },
              },
            },
          },
        },
      },
    });
    expect(instructions).toContain("Karim Maass");
    expect(instructions).not.toContain("nested-secret");
    expect(instructions).not.toContain("00000000-0000-4000-8000-000000000001");
  });

  test("fails safety-critical cases on provider/error failure", async () => {
    const securityCase = CAPACITY_EVAL_CORPUS.find((item) => item.id === "security-token")!;
    const report = await evaluateCorpus([securityCase], () => ({ error: "provider unavailable" }));
    expect(report.failed).toBe(1);
    expect(report.cases[0].safetyCritical).toBe(true);
    expect(report.cases[0].actual.outcome).toBe("ERROR");
  });

  test("redacts secrets from provider results and serialized reports", () => {
    const redacted = redactEvaluation({
      Authorization: "Bearer abc123",
      password: "top-secret",
      nested: "api_key=hidden",
    });
    expect(JSON.stringify(redacted)).not.toContain("abc123");
    expect(JSON.stringify(redacted)).not.toContain("top-secret");
    expect(JSON.stringify(redacted)).not.toContain("hidden");
    expect(JSON.stringify(redacted)).toContain("[REDACTED]");
    const legitimate = redactEvaluation({ title: "API Key Migration and Secret Rotation" });
    expect(JSON.stringify(legitimate)).toContain("API Key Migration");
    expect(JSON.stringify(legitimate)).toContain("Secret Rotation");
    const sensitiveKeys = redactEvaluation({
      secret: "actual-secret",
      apiKey: "actual-api-key",
      serviceRoleKey: "actual-service-role-key",
      title: "Secret Rotation",
    });
    expect(JSON.stringify(sensitiveKeys)).not.toContain("actual-secret");
    expect(JSON.stringify(sensitiveKeys)).not.toContain("actual-api-key");
    expect(JSON.stringify(sensitiveKeys)).toContain("Secret Rotation");
  });
});
