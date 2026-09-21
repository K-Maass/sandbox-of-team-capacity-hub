// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import { CAPACITY_ASSISTANT_TOOLS_V2, parseSemanticToolCall } from "./assistant-tools.server";

const toolNameByType = {
  read: "emit_capacity_read",
  write: "emit_capacity_write",
  relativeWrite: "emit_capacity_relative_write",
  clarification: "emit_capacity_clarification",
  unsupported: "emit_capacity_unsupported",
  multiple_changes: "emit_capacity_multiple_changes",
  conversation_or_help: "emit_capacity_conversation_help",
} as const;

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
  const isObjectSchema =
    record.type === "object" || (Array.isArray(record.type) && record.type.includes("object"));
  if (isObjectSchema) expect(record.additionalProperties).toBe(false);
  for (const child of Object.values(record)) assertClosedObjects(child);
}

function assertEveryPropertyRequired(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertEveryPropertyRequired(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const isObjectSchema =
    record.type === "object" || (Array.isArray(record.type) && record.type.includes("object"));
  if (isObjectSchema) {
    const properties = record.properties as Record<string, unknown>;
    expect(record.required).toEqual(expect.arrayContaining(Object.keys(properties)));
  }
  for (const child of Object.values(record)) assertEveryPropertyRequired(child);
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
  if (!value || typeof value !== "object" || Array.isArray(value))
    return parseSemanticToolCall("emit_capacity_clarification", JSON.stringify(value));
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string") {
    const { type, ...fields } = record;
    return parseSemanticToolCall(
      toolNameByType[type as keyof typeof toolNameByType],
      JSON.stringify(fields),
    );
  }
  if (typeof record.outcome === "string") {
    const { outcome, ...fields } = record;
    return parseSemanticToolCall(
      toolNameByType[outcome as keyof typeof toolNameByType],
      JSON.stringify(fields),
    );
  }
  return parseSemanticToolCall("emit_capacity_clarification", JSON.stringify(value));
}

describe("Luna V2 semantic tool", () => {
  test("exposes exactly seven strict native function tools", () => {
    expect(CAPACITY_ASSISTANT_TOOLS_V2).toHaveLength(7);
    expect(CAPACITY_ASSISTANT_TOOLS_V2.map((tool) => tool.name)).toEqual([
      "emit_capacity_read",
      "emit_capacity_write",
      "emit_capacity_relative_write",
      "emit_capacity_clarification",
      "emit_capacity_unsupported",
      "emit_capacity_multiple_changes",
      "emit_capacity_conversation_help",
    ]);
    for (const tool of CAPACITY_ASSISTANT_TOOLS_V2) {
      expect(tool).toMatchObject({ type: "function", strict: true });
      expect(tool.parameters).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(JSON.stringify(tool.parameters)).not.toContain('"oneOf"');
      expect(JSON.stringify(tool.parameters)).not.toContain('"anyOf"');
    }
  });

  test("keeps every provider schema object closed and required", () => {
    for (const tool of CAPACITY_ASSISTANT_TOOLS_V2) {
      assertClosedObjects(tool.parameters);
      assertEveryPropertyRequired(tool.parameters);
    }
  });

  test("represents all seven outcomes and the gated action vocabulary", () => {
    const serialized = JSON.stringify(CAPACITY_ASSISTANT_TOOLS_V2);
    for (const toolName of Object.values(toolNameByType)) expect(serialized).toContain(toolName);
    for (const action of [
      "getCapacityRange",
      "listConsultantsRange",
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
    expect(collectLiteralValues(CAPACITY_ASSISTANT_TOOLS_V2, "enum")).toEqual(
      expect.arrayContaining(["current_context", "date", "week_range"]),
    );
  });

  test("has no executable or authoritative fields", () => {
    const serialized = JSON.stringify(CAPACITY_ASSISTANT_TOOLS_V2);
    expect(serialized).not.toMatch(/"(?:id|uuid|jwt|token|secret|password|sql|query|rows)"/i);
    expect(serialized).not.toContain("IBM_SERVICES_API_KEY");
    expect(serialized).toContain("week_range");
    expect(serialized).toContain("startWeekOffset");
    expect(serialized).toContain("durationWeeks");
  });

  test("keeps required keys and expressible constraints aligned with the Zod contract", () => {
    const parameters = CAPACITY_ASSISTANT_TOOLS_V2;
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
    expect(listDemands?.required).toEqual(expect.arrayContaining(["kind"]));
    expect(relativeWeekday?.required).toEqual(expect.arrayContaining(["kind", "weekday"]));
    expect(createDemand?.required).toEqual(expect.arrayContaining(["kind", "demandCreate"]));

    const demandPatch = (updateDemand?.properties as Record<string, unknown> | undefined)?.patch;
    expect(JSON.stringify(demandPatch)).toContain('"required"');
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
      { kind: "listConsultantsRange", range, capacityFilter: "available" },
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
    expect(() => parseSemanticToolCall("emit_capacity_clarification", "not-json")).toThrow(
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

  test("accepts one valid provider envelope for each of the seven outcomes", () => {
    const today = { kind: "date", date: "2026-09-16" };
    const validOutcomes = [
      {
        outcome: "read",
        action: { kind: "getCapacity", consultant: { kind: "self" }, onDate: today },
      },
      { outcome: "write", action: { kind: "createDemand", demand: { title: "Nestle" } } },
      {
        outcome: "relativeWrite",
        operation: {
          kind: "adjustConsultantCapacity",
          consultant: { kind: "self" },
          delta: 10,
        },
        asOf: today,
      },
      {
        outcome: "clarification",
        intentFamily: "create_demand",
        knownFacts: { title: "Nestle" },
        missing: ["client"],
        question: "Which client is Nestle for?",
        reason: "A client is needed.",
      },
      { outcome: "unsupported", reason: "history_undo_unavailable" },
      { outcome: "multiple_changes", changeCount: 2, reason: "Two changes were requested." },
      { outcome: "conversation_or_help", topic: "clarification" },
    ];

    for (const value of validOutcomes) {
      expect(() => parseRaw(value)).not.toThrow();
    }
  });

  test("maps actual seven-tool provider field names without information loss", () => {
    expect(
      parseSemanticToolCall(
        "emit_capacity_read",
        JSON.stringify({
          action: {
            kind: "listConsultants",
            skills: null,
            skillsAnyOf: ["AI"],
            skillsAllOf: null,
            status: "active",
            includePipeline: false,
            capacityFilter: "any",
          },
          presentation: null,
        }),
      ),
    ).toMatchObject({
      type: "read",
      action: {
        kind: "listConsultants",
        skills: { anyOf: ["AI"] },
      },
    });

    expect(
      parseSemanticToolCall(
        "emit_capacity_write",
        JSON.stringify({
          action: {
            kind: "createDemand",
            consultantRef: null,
            consultantCreate: null,
            demandRef: null,
            demandCreate: {
              title: "Nestle",
              client: null,
              type: "Project",
              status: "Incoming",
              description: null,
              skills: null,
              startDate: null,
              endDate: null,
              requiredCapacity: 100,
              owner: null,
            },
            startDate: null,
            endDate: null,
            patch: null,
            block: null,
            note: null,
            capacity: null,
          },
        }),
      ),
    ).toMatchObject({
      type: "write",
      action: {
        kind: "createDemand",
        demand: { title: "Nestle", type: "Project", status: "Incoming" },
      },
    });

    expect(
      parseSemanticToolCall(
        "emit_capacity_write",
        JSON.stringify({
          action: {
            kind: "updateDemand",
            demandRef: { kind: "name", name: "Nestle" },
            consultantRef: null,
            consultantCreate: null,
            demandCreate: null,
            startDate: null,
            endDate: null,
            patch: {
              name: null,
              surname: null,
              email: null,
              level: null,
              role: null,
              skills: null,
              workingCapacity: null,
              archived: null,
              title: null,
              client: null,
              type: null,
              status: "Incoming",
              description: null,
              startDate: null,
              endDate: null,
              requiredCapacity: null,
              owner: null,
              clearEmail: null,
              clearStartDate: null,
              clearEndDate: null,
              clearOwner: null,
            },
            block: null,
            note: null,
            capacity: null,
          },
        }),
      ),
    ).toEqual({
      type: "write",
      action: {
        kind: "updateDemand",
        demand: { kind: "name", name: "Nestle" },
        patch: { status: "Incoming" },
      },
    });

    expect(
      parseSemanticToolCall(
        "emit_capacity_read",
        JSON.stringify({
          action: {
            kind: "listDemands",
            owner: { kind: "self", name: null },
            statuses: null,
            types: null,
            activeOn: null,
            skills: null,
            includeClosed: true,
          },
          presentation: null,
        }),
      ),
    ).toMatchObject({
      type: "read",
      action: { kind: "listDemands", owner: { kind: "self" } },
    });

    expect(
      parseSemanticToolCall(
        "emit_capacity_read",
        JSON.stringify({
          action: {
            kind: "listConsultants",
            skills: ["AI"],
            status: "active",
            role: null,
            level: null,
            onDate: { kind: "date", date: "2026-09-16" },
            includePipeline: false,
            capacityFilter: "any",
          },
          presentation: null,
        }),
      ),
    ).toMatchObject({
      type: "read",
      action: { kind: "listConsultants", skills: { anyOf: ["AI"] } },
    });
  });

  test("normalizes action-owned provider fields without cross-action leakage", () => {
    expect(
      parseSemanticToolCall(
        "emit_capacity_read",
        JSON.stringify({
          action: {
            kind: "listConsultants",
            consultantStatus: "active",
            consultantRole: null,
            consultantLevel: null,
            consultantSkills: null,
            consultantSkillsAnyOf: ["AI"],
            consultantSkillsAllOf: null,
            consultantCapacityFilter: "available",
            demandStatuses: null,
            demandTypes: null,
            demandOwner: null,
            demandSkills: null,
            teamRole: null,
            teamLevel: null,
            capacityFocus: null,
            demandFocus: null,
            teamFocus: null,
            overviewFocus: null,
            availabilityMinimumFreeCapacity: null,
            availabilityMinimumWorkingDays: null,
            candidateMinimumSkillMatches: null,
            candidateLimit: null,
            suitableLimit: null,
            helpTopic: null,
            skillQuery: null,
            consultant: null,
            demand: null,
            range: null,
            onDate: { kind: "date", date: "2026-09-16" },
            activeOn: null,
            includePipeline: false,
            includeClosed: null,
          },
          presentation: null,
        }),
      ),
    ).toMatchObject({
      type: "read",
      action: {
        kind: "listConsultants",
        status: "active",
        skills: { anyOf: ["AI"] },
        capacityFilter: "available",
      },
    });

    expect(
      parseSemanticToolCall(
        "emit_capacity_read",
        JSON.stringify({
          action: {
            kind: "getTeamOverviewRange",
            consultant: null,
            demand: null,
            range: { kind: "week_range", startWeekOffset: 1, durationWeeks: 1 },
            onDate: null,
            activeOn: null,
            includePipeline: false,
            consultantStatus: null,
            demandStatuses: null,
            demandTypes: null,
            demandOwner: null,
            includeClosed: null,
            consultantRole: null,
            consultantLevel: null,
            teamRole: null,
            teamLevel: null,
            consultantSkills: null,
            consultantSkillsAnyOf: null,
            consultantSkillsAllOf: null,
            demandSkills: null,
            consultantCapacityFilter: null,
            capacityFocus: null,
            demandFocus: null,
            teamFocus: "free",
            overviewFocus: null,
            availabilityMinimumFreeCapacity: null,
            availabilityMinimumWorkingDays: null,
            candidateMinimumSkillMatches: null,
            candidateLimit: null,
            suitableLimit: null,
            helpTopic: null,
            skillQuery: null,
          },
          presentation: null,
        }),
      ),
    ).toMatchObject({
      type: "read",
      action: {
        kind: "getTeamOverviewRange",
        focus: "free",
      },
    });
  });

  test("removes only strict-schema null placeholders and preserves meaningful nulls", () => {
    const clarification = {
      outcome: "clarification",
      action: null,
      operation: null,
      asOf: null,
      presentation: null,
      intentFamily: "create_consultant",
      knownFacts: {
        consultant: {
          kind: "name",
          name: "Anna",
          surname: null,
          email: null,
          level: null,
          role: null,
          skills: null,
          workingCapacity: null,
        },
        demand: null,
        time: null,
        name: "Anna",
        surname: null,
        title: null,
        client: null,
        type: null,
        status: null,
        level: null,
        role: null,
        skills: null,
        capacity: null,
        delta: null,
        operation: null,
      },
      missing: ["surname", "level", "role"],
      question: "What are Anna's surname, level, and role?",
      reason: "A consultant requires those fields.",
      changeCount: null,
      topic: null,
    };
    expect(parseRaw(clarification)).toEqual({
      type: "clarification",
      intentFamily: "create_consultant",
      knownFacts: { consultant: { kind: "name", name: "Anna" }, name: "Anna" },
      missing: ["surname", "level", "role"],
      question: "What are Anna's surname, level, and role?",
      reason: "A consultant requires those fields.",
    });

    const updateDemand = {
      outcome: "write",
      action: {
        kind: "updateDemand",
        consultant: null,
        demand: {
          kind: "name",
          name: "Nestle",
          title: null,
          client: null,
          type: null,
          status: null,
          description: null,
          skills: null,
          startDate: null,
          endDate: null,
          requiredCapacity: null,
          owner: null,
        },
        range: null,
        onDate: null,
        activeOn: null,
        startDate: null,
        endDate: null,
        includePipeline: null,
        status: null,
        statuses: null,
        types: null,
        role: null,
        level: null,
        skills: null,
        capacityFilter: null,
        focus: null,
        minimumFreeCapacity: null,
        minimumWorkingDays: null,
        minimumSkillMatches: null,
        limit: null,
        topic: null,
        capacity: null,
        note: null,
        block: null,
        patch: {
          name: null,
          surname: null,
          email: null,
          level: null,
          role: null,
          skills: null,
          workingCapacity: null,
          archived: null,
          title: null,
          client: null,
          type: null,
          status: null,
          description: null,
          startDate: null,
          endDate: null,
          requiredCapacity: null,
          owner: null,
          clearEmail: null,
          clearStartDate: true,
          clearEndDate: true,
          clearOwner: true,
        },
        delta: null,
        skill: null,
        operation: null,
      },
      operation: null,
      asOf: null,
      presentation: null,
      intentFamily: null,
      knownFacts: null,
      missing: null,
      question: null,
      reason: null,
      changeCount: null,
      topic: null,
    };
    expect(parseRaw(updateDemand)).toEqual({
      type: "write",
      action: {
        kind: "updateDemand",
        demand: { kind: "name", name: "Nestle" },
        patch: { startDate: null, endDate: null, owner: null },
      },
    });
  });

  test("rejects cross-outcome fields and invalid nested combinations without repair", () => {
    const invalid = [
      {
        outcome: "read",
        action: {
          kind: "getCapacity",
          consultant: { kind: "self", name: "Anna" },
          onDate: { kind: "date", date: "2026-09-16" },
          delta: 10,
        },
      },
      {
        outcome: "write",
        action: { kind: "createDemand", demand: { title: "Nestle" } },
        question: "Unexpected clarification field",
      },
      {
        outcome: "relativeWrite",
        operation: {
          kind: "adjustConsultantCapacity",
          consultant: { kind: "self" },
          delta: 10,
        },
        asOf: { kind: "date", date: "2026-09-16" },
        action: { kind: "getTeamOverview", onDate: { kind: "current_context" } },
      },
      {
        outcome: "write",
        action: {
          kind: "createDemand",
          demand: { kind: "name", name: "Nestle", title: "Conflicting demand shape" },
        },
      },
    ];

    for (const value of invalid) expect(() => parseRaw(value)).toThrow();
  });

  test("rejects missing outcome-specific fields and unknown outcomes", () => {
    const missing = [
      {
        outcome: "read",
        action: { kind: "getCapacity", consultant: { kind: "self" } },
      },
      { outcome: "write", action: { kind: "createConsultant", consultant: { name: "Anna" } } },
      {
        outcome: "clarification",
        intentFamily: "create_demand",
        knownFacts: {},
        missing: ["client"],
        reason: "A client is needed.",
      },
      {
        outcome: "relativeWrite",
        operation: { kind: "adjustConsultantCapacity", consultant: { kind: "self" } },
        asOf: { kind: "date", date: "2026-09-16" },
      },
    ];

    for (const value of missing) expect(() => parseRaw(value)).toThrow();
    expect(() => parseRaw({ outcome: "not_a_real_outcome" })).toThrow();
    expect(() =>
      parseSemanticToolCall(
        "emit_capacity_clarification",
        JSON.stringify({ type: "unsupported", reason: "history_undo_unavailable" }),
      ),
    ).toThrow();
  });

  test("keeps provider text constraints compatible while strict parsing owns safety", () => {
    expect(JSON.stringify(CAPACITY_ASSISTANT_TOOLS_V2)).not.toContain("(?");
    for (const value of [
      "API_KEY=hidden",
      "bEaReR abcdefghijklmnop",
      "sElEcT * fRoM consultants",
      "GHp_12345678901",
    ]) {
      expect(() =>
        parseRaw({ outcome: "write", action: { kind: "createDemand", demand: { title: value } } }),
      ).toThrow();
    }
    expect(() =>
      parseRaw({
        outcome: "write",
        action: { kind: "createDemand", demand: { title: "API Key Migration" } },
      }),
    ).not.toThrow();
    expect(() =>
      parseRaw({
        outcome: "write",
        action: { kind: "createDemand", demand: { title: "Secret Rotation" } },
      }),
    ).not.toThrow();
  });
});
