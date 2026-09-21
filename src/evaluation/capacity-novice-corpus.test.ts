// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import { semanticIntentFamilySchema } from "@/domain/capacity/assistant-semantic";
import {
  CAPACITY_NOVICE_EVAL_CORPUS,
  NOVICE_EVAL_CASE_COUNT,
  NOVICE_EVAL_CASES_PER_CATEGORY,
  NOVICE_EVAL_CATEGORY_COUNT,
} from "./capacity-novice-corpus";
import { evaluateCorpus } from "./evaluator";

describe("1000-case novice Capacity Assistant evaluation matrix", () => {
  test("contains exactly 1000 unique natural-language cases across 25 balanced categories", () => {
    expect(NOVICE_EVAL_CATEGORY_COUNT).toBe(25);
    expect(NOVICE_EVAL_CASES_PER_CATEGORY).toBe(40);
    expect(NOVICE_EVAL_CASE_COUNT).toBe(1000);
    expect(CAPACITY_NOVICE_EVAL_CORPUS).toHaveLength(1000);

    expect(new Set(CAPACITY_NOVICE_EVAL_CORPUS.map((item) => item.id)).size).toBe(1000);
    expect(new Set(CAPACITY_NOVICE_EVAL_CORPUS.map((item) => item.userMessage)).size).toBe(1000);

    const categories = new Map<string, number>();
    for (const item of CAPACITY_NOVICE_EVAL_CORPUS)
      categories.set(item.noviceCategory, (categories.get(item.noviceCategory) ?? 0) + 1);

    expect(categories.size).toBe(25);
    for (const count of categories.values()) expect(count).toBe(40);
  });

  test("covers read, write, relative-write, clarification, unsupported, multiple-change, and help outcomes", () => {
    const outcomes = new Set(CAPACITY_NOVICE_EVAL_CORPUS.map((item) => item.expectedOutcome));
    expect(outcomes).toEqual(
      new Set([
        "READ",
        "WRITE",
        "RELATIVE_WRITE",
        "CLARIFICATION",
        "UNSUPPORTED",
        "MULTIPLE_CHANGES",
        "CONVERSATION_OR_HELP",
      ]),
    );

    const requiredFamilies = [
      "list_consultants",
      "team_overview",
      "list_consultants_range",
      "team_overview_range",
      "capacity_point",
      "capacity_range",
      "consultant_details",
      "demand_details",
      "list_demands",
      "staffing_candidates",
      "staffing_candidates_range",
      "suitable_demands",
      "availability_windows",
      "skill_supply_demand",
      "create_consultant",
      "create_demand",
      "update_consultant",
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
    const actualFamilies = new Set(CAPACITY_NOVICE_EVAL_CORPUS.map((item) => item.expectedIntentFamily));
    for (const family of requiredFamilies) expect(actualFamilies.has(family)).toBe(true);
  });

  test("keeps executable semantic families aligned to the canonical V2 vocabulary", () => {
    for (const item of CAPACITY_NOVICE_EVAL_CORPUS) {
      if (
        item.expectedIntentFamily === "unsupported" ||
        item.expectedIntentFamily === "multiple_changes" ||
        item.expectedIntentFamily === "conversation_or_help" ||
        item.expectedIntentFamily.startsWith("clarification_")
      )
        continue;
      expect(semanticIntentFamilySchema.safeParse(item.expectedIntentFamily).success).toBe(true);
    }
  });

  test("contains no authoritative IDs or credential-shaped values and never auto-confirms writes", () => {
    for (const item of CAPACITY_NOVICE_EVAL_CORPUS) {
      const serialized = JSON.stringify(item);
      expect(serialized).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
      );
      expect(serialized).not.toMatch(/\b(?:sk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b/i);
      expect(serialized).not.toMatch(/bearer\s+[A-Za-z0-9._~+/=-]{8,}/i);
      expect(item.userMessage.trim().length).toBeGreaterThan(2);
      expect(item.userMessage.length).toBeLessThanOrEqual(4000);
      expect(item.expectedImportantArguments).toBeDefined();
      expect(item.tags).toContain("novice");
    }
  });

  test("marks every mutation and unsafe request safety-critical", () => {
    for (const item of CAPACITY_NOVICE_EVAL_CORPUS) {
      if (
        item.expectedOutcome === "WRITE" ||
        item.expectedOutcome === "RELATIVE_WRITE" ||
        item.expectedOutcome === "UNSUPPORTED" ||
        item.expectedOutcome === "MULTIPLE_CHANGES"
      )
        expect(item.safetyCritical).toBe(true);
    }
  });

  test("runs all 1000 cases through the evaluator without structural scoring failures", async () => {
    const report = await evaluateCorpus(CAPACITY_NOVICE_EVAL_CORPUS, (item) => ({
      semanticActual: {
        outcome: item.expectedOutcome,
        intentFamily: item.expectedIntentFamily,
        importantArguments: item.expectedImportantArguments,
      },
    }));

    expect(report.total).toBe(1000);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1000);
  });
});
