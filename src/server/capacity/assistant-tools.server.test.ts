// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import {
  CAPACITY_ASSISTANT_TOOLS_V2,
  CAPACITY_SEMANTIC_TOOL,
  parseSemanticToolCall,
} from "./assistant-tools.server";

function collectLiteralValues(value: unknown, key: string, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLiteralValues(item, key, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [property, child] of Object.entries(value)) {
    if (property === key && Array.isArray(child)) {
      for (const item of child) if (typeof item === "string") output.push(item);
    }
    collectLiteralValues(child, key, output);
  }
  return output;
}

function assertClosedObjects(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertClosedObjects(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.type === "object") expect(record.additionalProperties).toBe(false);
  for (const child of Object.values(record)) assertClosedObjects(child);
}

function findObjectWithLiteral(
  value: unknown,
  property: string,
  expected: string,
): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findObjectWithLiteral(item, property, expected);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const properties = record.properties as Record<string, unknown> | undefined;
  const candidate = properties?.[property] as Record<string, unknown> | undefined;
  if (Array.isArray(candidate?.enum) && candidate.enum.includes(expected)) return record;
  for (const child of Object.values(record)) {
    const found = findObjectWithLiteral(child, property, expected);
    if (found) return found;
  }
  return undefined;
}

function parseRaw(value: unknown) {
  return parseSemanticToolCall("emit_capacity_semantic_outcome", JSON.stringify(value));
}

describe("Luna V2 semantic tool", () => {
  test("exposes exactly one strict native function tool", () => {
    expect(CAPACITY_ASSISTANT_TOOLS_V2).toHaveLength(1);
    expect(CAPACITY_SEMANTIC_TOOL).toMatchObject({
      type: "function",
      name: "emit_capacity_semantic_outcome",
      strict: true,
    });
    expect(CAPACITY_SEMANTIC_TOOL.parameters).toHaveProperty("oneOf");
  });

  test("keeps every schema object closed, including nested semantic branches", () => {
    assertClosedObjects(CAPACITY_SEMANTIC_TOOL.parameters);
    const rootBranches = CAPACITY_SEMANTIC_TOOL.parameters.oneOf as unknown[];
    expect(rootBranches).toHaveLength(7);
    expect(
      rootBranches.every(
        (branch) => (branch as Record<string, unknown>).additionalProperties === false,
      ),
    ).toBe(true);
  });

  test("represents all seven outcomes and the gated action vocabulary", () => {
    const serialized = JSON.stringify(CAPACITY_SEMANTIC_TOOL.parameters);
    for (const outcome of [
      "read",
      "write",
      "relativeWrite",
      "clarification",
      "unsupported",
      "multiple_changes",
      "conversation_or_help",
    ]) {
      expect(serialized).toContain(`"${outcome}"`);
    }
    for (const action of [
      "getCapacityRange",
      "getTeamOverviewRange",
      "createDemand",
      "updateConsultant",
      "setAllocation",
      "addAvailabilityBlock",
      "adjustConsultantCapacity",
      "adjustAllocation",
      "adjustDemandCapacity",
      "changeConsultantSkill",
      "updateConsultantProfile",
    ]) {
      expect(serialized).toContain(`"${action}"`);
    }
    expect(collectLiteralValues(CAPACITY_SEMANTIC_TOOL.parameters, "enum")).toEqual(
      expect.arrayContaining([
        "read",
        "write",
        "relativeWrite",
        "clarification",
        "unsupported",
        "multiple_changes",
        "conversation_or_help",
      ]),
    );
  });

  test("has no executable or authoritative fields", () => {
    const serialized = JSON.stringify(CAPACITY_SEMANTIC_TOOL.parameters);
    expect(serialized).not.toMatch(/"(?:id|uuid|jwt|token|secret|password|sql|query|rows)"/i);
    expect(serialized).not.toContain("IBM_SERVICES_API_KEY");
    expect(serialized).toContain("week_range");
    expect(serialized).toContain("startWeekOffset");
    expect(serialized).toContain("durationWeeks");
  });

  test("keeps required keys and expressible constraints aligned with the Zod contract", () => {
    const parameters = CAPACITY_SEMANTIC_TOOL.parameters;
    const listDemands = findObjectWithLiteral(parameters, "kind", "listDemands");
    const relativeWeekday = findObjectWithLiteral(parameters, "kind", "relative_weekday");
    const createDemand = findObjectWithLiteral(parameters, "kind", "createDemand");
    const updateDemand = findObjectWithLiteral(parameters, "kind", "updateDemand");
    const setAllocation = findObjectWithLiteral(parameters, "kind", "setAllocation");
    const rangeCandidates = findObjectWithLiteral(
      parameters,
      "kind",
      "findStaffingCandidatesRange",
    );
    expect(listDemands?.required).toEqual(["kind"]);
    expect(relativeWeekday?.required).toEqual(["kind", "weekday"]);
    expect(createDemand?.required).toEqual(["kind", "demand"]);

    const demandPatch = (updateDemand?.properties as Record<string, unknown> | undefined)?.patch;
    expect(JSON.stringify(demandPatch)).toContain('"minProperties":1');
    expect(JSON.stringify(setAllocation)).toContain('"multipleOf":5');
    expect(JSON.stringify(rangeCandidates)).toContain('"default":20');
    expect(JSON.stringify(rangeCandidates)).toContain('"maximum":100');
  });

  test("raw tool-shaped representatives parse through the canonical semantic outcome union", () => {
    const self = { kind: "self" } as const;
    const phoenix = { kind: "name", name: "Phoenix" } as const;
    const today = { kind: "date", date: "2026-09-16" } as const;
    const range = { kind: "week_range", startWeekOffset: 1, durationWeeks: 2 } as const;

    const reads = [
      { kind: "listConsultants" },
      { kind: "getConsultant", consultant: self },
      { kind: "listDemands" },
      { kind: "getDemand", demand: phoenix },
      { kind: "getCapacity", consultant: self, onDate: today },
      { kind: "getCapacityRange", consultant: self, range },
      { kind: "getTeamOverviewRange", range },
      { kind: "findAvailabilityWindows", range, minimumFreeCapacity: 50, minimumWorkingDays: 3 },
      { kind: "findStaffingCandidatesRange", demand: phoenix, range },
      { kind: "findSuitableDemands", consultant: self, range },
      { kind: "skillSupplyDemand", range },
      { kind: "productHelp", topic: "freeCapacity" },
      { kind: "findStaffingCandidates", demand: phoenix, onDate: today },
      { kind: "getTeamOverview", onDate: today },
    ];
    for (const action of reads) {
      expect(() => parseRaw({ type: "read", action })).not.toThrow();
    }

    const writes = [
      { kind: "createConsultant", consultant: { name: "Anna", surname: "Jones" } },
      { kind: "updateConsultant", consultant: self, patch: { role: "Data" } },
      { kind: "createDemand", demand: { title: "Nestle" } },
      { kind: "updateDemand", demand: phoenix, patch: { status: "Incoming" } },
      { kind: "setAllocation", consultant: self, demand: phoenix, capacity: 50 },
      { kind: "removeAllocation", consultant: self, demand: phoenix },
      {
        kind: "addAvailabilityBlock",
        consultant: self,
        startDate: today,
        endDate: { kind: "days_from_today", days: 2 },
      },
      {
        kind: "removeAvailabilityBlock",
        block: { consultant: self, startDate: today, endDate: today },
      },
    ];
    for (const action of writes) {
      expect(() => parseRaw({ type: "write", action })).not.toThrow();
    }

    const relativeWrites = [
      { kind: "adjustConsultantCapacity", consultant: self, delta: 10 },
      { kind: "adjustAllocation", consultant: self, demand: phoenix, delta: -5 },
      { kind: "adjustDemandCapacity", demand: phoenix, delta: 100 },
      { kind: "changeConsultantSkill", consultant: self, skill: "Python", operation: "add" },
      { kind: "updateConsultantProfile", consultant: self, role: "Data" },
    ];
    for (const operation of relativeWrites) {
      expect(() => parseRaw({ type: "relativeWrite", operation, asOf: today })).not.toThrow();
    }

    for (const outcome of [
      {
        type: "clarification",
        intentFamily: "create_demand",
        knownFacts: { title: "Phoenix" },
        missing: ["client"],
        question: "Which client is Phoenix for?",
        reason: "The client is needed.",
      },
      { type: "unsupported", reason: "history_undo_unavailable" },
      { type: "multiple_changes", changeCount: 2, reason: "Two changes were requested." },
      { type: "conversation_or_help", topic: "clarification" },
    ]) {
      expect(() => parseRaw(outcome)).not.toThrow();
    }
  });

  test("canonical parser rejects unsafe, invalid, malformed, and misnamed tool calls", () => {
    const unsafe = [
      { type: "write", action: { kind: "createDemand", demand: { title: "api_key=hidden" } } },
      { type: "write", action: { kind: "createDemand", demand: { title: "API_KEY=hidden" } } },
      {
        type: "write",
        action: {
          kind: "createDemand",
          demand: { title: "SELECT * FROM consultants" },
        },
      },
      {
        type: "write",
        action: {
          kind: "createDemand",
          demand: { title: "sElEcT * fRoM consultants" },
        },
      },
      {
        type: "clarification",
        intentFamily: "create_demand",
        knownFacts: { title: "Bearer abcdefghijklmnop" },
        missing: ["client"],
        question: "Which client?",
        reason: "Need a client.",
      },
      {
        type: "read",
        action: {
          kind: "getCapacity",
          consultant: { kind: "name", name: "00000000-0000-4000-8000-000000000001" },
          onDate: { kind: "date", date: "2026-02-30" },
        },
      },
      {
        type: "write",
        action: { kind: "createDemand", demand: { title: "GHp_12345678901" } },
      },
    ];
    for (const value of unsafe) expect(() => parseRaw(value)).toThrow();
    expect(() => parseSemanticToolCall("different_tool", "{}")).toThrow("UNKNOWN_SEMANTIC_TOOL");
    expect(() => parseSemanticToolCall("emit_capacity_semantic_outcome", "not-json")).toThrow(
      "INVALID_SEMANTIC_TOOL_ARGUMENTS",
    );

    const reversedRange = {
      type: "read",
      action: {
        kind: "getCapacityRange",
        consultant: { kind: "self" },
        range: { kind: "range", startDate: "2026-09-25", endDate: "2026-09-21" },
      },
    };
    expect(() => parseRaw(reversedRange)).toThrow();

    expect(() =>
      parseRaw({
        type: "write",
        action: { kind: "createDemand", demand: { title: "API Key Migration" } },
      }),
    ).not.toThrow();
    expect(() =>
      parseRaw({
        type: "write",
        action: { kind: "createDemand", demand: { title: "Secret Rotation" } },
      }),
    ).not.toThrow();
  });

  test("schema text patterns reject mixed-case adversarial values but allow business titles", () => {
    const createDemand = findObjectWithLiteral(
      CAPACITY_SEMANTIC_TOOL.parameters,
      "kind",
      "createDemand",
    );
    const demand = (createDemand?.properties as Record<string, unknown> | undefined)?.demand as
      Record<string, unknown> | undefined;
    const title = (demand?.properties as Record<string, unknown> | undefined)?.title as
      Record<string, unknown> | undefined;
    const pattern = title?.pattern;
    expect(typeof pattern).toBe("string");
    const matcher = new RegExp(pattern as string);
    for (const value of [
      "API_KEY=hidden",
      "bEaReR abcdefghijklmnop",
      "sElEcT * fRoM consultants",
      "GHp_12345678901",
    ]) {
      expect(matcher.test(value)).toBe(false);
    }
    expect(matcher.test("API Key Migration")).toBe(true);
    expect(matcher.test("Secret Rotation")).toBe(true);
  });
});
