// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import {
  safeSemanticFactsSchema,
  semanticConsultantRefSchema,
  semanticConversationOrHelpSchema,
  semanticDemandRefSchema,
  semanticMultipleChangesSchema,
  semanticOutcomeSchema,
  semanticReadActionSchema,
  semanticTimeRefSchema,
  semanticUnsupportedSchema,
  semanticWriteActionSchema,
} from "./assistant-semantic";

const SELF = { kind: "self" } as const;
const CONTEXT_CONSULTANT = { kind: "current_context" } as const;
const CONTEXT_DEMAND = { kind: "current_context" } as const;
const TODAY = { kind: "date", date: "2026-09-16" } as const;
const NEXT_WEEK = { kind: "week_offset", weeks: 1 } as const;
const NEXT_TWO_WEEKS = {
  kind: "week_range",
  startWeekOffset: 1,
  durationWeeks: 2,
} as const;
const THIS_FRIDAY = { kind: "relative_weekday", weekday: "friday" } as const;
const RANGE = { kind: "range", startDate: "2026-09-21", endDate: "2026-09-25" } as const;

describe("Luna semantic contracts", () => {
  test("accepts bounded semantic consultant and demand references", () => {
    expect(semanticConsultantRefSchema.parse(SELF)).toEqual(SELF);
    expect(semanticConsultantRefSchema.parse(CONTEXT_CONSULTANT)).toEqual(CONTEXT_CONSULTANT);
    expect(semanticConsultantRefSchema.parse({ kind: "name", name: "Alex Smith" })).toEqual({
      kind: "name",
      name: "Alex Smith",
    });
    expect(semanticDemandRefSchema.parse(CONTEXT_DEMAND)).toEqual(CONTEXT_DEMAND);
    expect(semanticDemandRefSchema.parse({ kind: "name", name: "Phoenix" })).toEqual({
      kind: "name",
      name: "Phoenix",
    });
  });

  test("accepts every bounded semantic time form and rejects invalid ranges", () => {
    for (const value of [
      CONTEXT_CONSULTANT,
      TODAY,
      RANGE,
      NEXT_WEEK,
      NEXT_TWO_WEEKS,
      { kind: "days_from_today", days: -3 },
      THIS_FRIDAY,
      { kind: "relative_weekday", weekday: "monday", weekOffset: 2 },
    ]) {
      expect(semanticTimeRefSchema.safeParse(value).success).toBe(true);
    }

    expect(semanticTimeRefSchema.safeParse({ kind: "date", date: "2026-02-30" }).success).toBe(
      false,
    );
    expect(
      semanticTimeRefSchema.safeParse({
        kind: "range",
        startDate: "2026-09-25",
        endDate: "2026-09-21",
      }).success,
    ).toBe(false);
    expect(semanticTimeRefSchema.safeParse({ kind: "days_from_today", days: 731 }).success).toBe(
      false,
    );
  });

  test("covers every existing closed read capability", () => {
    const reads = [
      {
        kind: "listConsultants",
        skills: { anyOf: ["AI"] },
        onDate: TODAY,
        capacityFilter: "available",
      },
      { kind: "getConsultant", consultant: SELF, onDate: TODAY },
      { kind: "listDemands", statuses: ["Incoming"], owner: SELF },
      { kind: "getDemand", demand: CONTEXT_DEMAND, onDate: TODAY, focus: "staffing_gap" },
      { kind: "getCapacity", consultant: SELF, onDate: TODAY, focus: "free" },
      { kind: "getCapacityRange", consultant: SELF, range: RANGE, focus: "breakdown" },
      { kind: "getTeamOverviewRange", range: RANGE, focus: "utilization" },
      {
        kind: "findAvailabilityWindows",
        range: RANGE,
        minimumFreeCapacity: 50,
        minimumWorkingDays: 3,
      },
      {
        kind: "findStaffingCandidatesRange",
        demand: { kind: "name", name: "Phoenix" },
        range: RANGE,
      },
      { kind: "findSuitableDemands", consultant: SELF, range: RANGE },
      { kind: "skillSupplyDemand", range: RANGE, skill: "AI" },
      { kind: "productHelp", topic: "freeCapacity" },
      { kind: "findStaffingCandidates", demand: { kind: "name", name: "Phoenix" }, onDate: TODAY },
      { kind: "getTeamOverview", onDate: TODAY, focus: "overallocated" },
    ] as const;

    for (const read of reads) expect(semanticReadActionSchema.safeParse(read).success).toBe(true);
    expect(new Set(reads.map((read) => read.kind)).size).toBe(14);
  });

  test("accepts preview-only writes and all relative write operations", () => {
    const writes = [
      {
        kind: "createConsultant",
        consultant: { name: "Anna", surname: "Jones", level: "Senior", role: "Data" },
      },
      { kind: "updateConsultant", consultant: SELF, patch: { role: "Data" } },
      {
        kind: "createDemand",
        demand: { title: "Phoenix", startDate: TODAY, endDate: NEXT_WEEK, skills: ["AI"] },
      },
      { kind: "updateDemand", demand: CONTEXT_DEMAND, patch: { status: "Won" } },
      {
        kind: "setAllocation",
        consultant: SELF,
        demand: { kind: "name", name: "Phoenix" },
        capacity: 50,
      },
      { kind: "removeAllocation", consultant: SELF, demand: CONTEXT_DEMAND },
      {
        kind: "addAvailabilityBlock",
        consultant: SELF,
        startDate: TODAY,
        endDate: { kind: "days_from_today", days: 2 },
      },
      {
        kind: "removeAvailabilityBlock",
        block: { consultant: SELF, startDate: TODAY, endDate: NEXT_WEEK },
      },
    ] as const;
    for (const write of writes)
      expect(semanticWriteActionSchema.safeParse(write).success).toBe(true);

    const relativeWrites = [
      { kind: "adjustConsultantCapacity", consultant: SELF, delta: -10 },
      {
        kind: "adjustAllocation",
        consultant: SELF,
        demand: { kind: "name", name: "Phoenix" },
        delta: 10,
      },
      { kind: "adjustDemandCapacity", demand: CONTEXT_DEMAND, delta: 100 },
      { kind: "changeConsultantSkill", consultant: SELF, skill: "Python", operation: "add" },
      { kind: "updateConsultantProfile", consultant: SELF, role: "Data" },
    ] as const;
    for (const operation of relativeWrites) {
      expect(
        semanticOutcomeSchema.safeParse({ type: "relativeWrite", operation, asOf: TODAY }).success,
      ).toBe(true);
    }
  });

  test("accepts every non-executable outcome", () => {
    const outcomes = [
      {
        type: "read",
        action: { kind: "getTeamOverview", onDate: TODAY, focus: "overallocated" },
        presentation: "overallocated_consultants",
      },
      {
        type: "write",
        action: { kind: "updateConsultant", consultant: SELF, patch: { role: "Data" } },
      },
      {
        type: "clarification",
        intentFamily: "set_allocation",
        knownFacts: { consultant: SELF, capacity: 50 },
        missing: ["demand"],
        question: "Which demand should I use?",
        reason: "The request names a capacity but not a demand.",
      },
      { type: "unsupported", reason: "security_request" },
      { type: "multiple_changes", changeCount: 2, reason: "The request contains two changes." },
      { type: "conversation_or_help", topic: "howToUse" },
    ] as const;
    for (const outcome of outcomes)
      expect(semanticOutcomeSchema.safeParse(outcome).success).toBe(true);
    expect(semanticConversationOrHelpSchema.parse(outcomes[5])).toEqual(outcomes[5]);
    expect(semanticUnsupportedSchema.parse(outcomes[3])).toEqual(outcomes[3]);
    expect(semanticMultipleChangesSchema.parse(outcomes[4])).toEqual(outcomes[4]);
  });

  test("defaults candidate-query limits to 20 while allowing at most 100", () => {
    for (const read of [
      { kind: "findStaffingCandidatesRange", demand: CONTEXT_DEMAND, range: RANGE },
      { kind: "findSuitableDemands", consultant: SELF, range: RANGE },
      { kind: "findStaffingCandidates", demand: CONTEXT_DEMAND, onDate: TODAY },
    ]) {
      const parsed = semanticReadActionSchema.parse(read) as { limit: number };
      expect(parsed.limit).toBe(20);
    }
    expect(
      semanticReadActionSchema.safeParse({
        kind: "findSuitableDemands",
        consultant: SELF,
        range: RANGE,
        limit: 101,
      }).success,
    ).toBe(false);
  });

  test("rejects reversed literal dates in all four write shapes", () => {
    const reversedStart = { kind: "date", date: "2026-09-25" } as const;
    const reversedEnd = { kind: "date", date: "2026-09-21" } as const;
    expect(
      semanticWriteActionSchema.safeParse({
        kind: "createDemand",
        demand: { title: "Phoenix", startDate: reversedStart, endDate: reversedEnd },
      }).success,
    ).toBe(false);
    expect(
      semanticWriteActionSchema.safeParse({
        kind: "updateDemand",
        demand: CONTEXT_DEMAND,
        patch: { startDate: reversedStart, endDate: reversedEnd },
      }).success,
    ).toBe(false);
    expect(
      semanticWriteActionSchema.safeParse({
        kind: "addAvailabilityBlock",
        consultant: SELF,
        startDate: reversedStart,
        endDate: reversedEnd,
      }).success,
    ).toBe(false);
    expect(
      semanticWriteActionSchema.safeParse({
        kind: "removeAvailabilityBlock",
        block: { consultant: SELF, startDate: reversedStart, endDate: reversedEnd },
      }).success,
    ).toBe(false);
  });

  test("rejects IDs, unknown fields, arbitrary SQL, and unbounded facts", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(semanticConsultantRefSchema.safeParse({ kind: "name", name: id }).success).toBe(false);
    expect(semanticConsultantRefSchema.safeParse({ consultantId: id }).success).toBe(false);
    expect(
      semanticDemandRefSchema.safeParse({ kind: "name", name: "Phoenix", demandId: id }).success,
    ).toBe(false);
    expect(
      semanticReadActionSchema.safeParse({
        kind: "productHelp",
        topic: "pipeline",
        sql: "select 1",
      }).success,
    ).toBe(false);
    expect(safeSemanticFactsSchema.safeParse({ sql: "select * from consultants" }).success).toBe(
      false,
    );
    expect(
      safeSemanticFactsSchema.safeParse({ skills: Array.from({ length: 51 }, () => "AI") }).success,
    ).toBe(false);
    expect(
      semanticOutcomeSchema.safeParse({
        type: "clarification",
        intentFamily: "set_allocation",
        knownFacts: { rows: [{ id }] },
        missing: ["demand"],
        question: "Which demand?",
        reason: "Need a demand.",
      }).success,
    ).toBe(false);
  });

  test("guards free-text values without blocking ordinary business titles", () => {
    const safeTitles = ["API Key Migration", "Secret Rotation"];
    for (const title of safeTitles) {
      expect(
        semanticWriteActionSchema.safeParse({ kind: "createDemand", demand: { title } }).success,
      ).toBe(true);
    }
    expect(
      semanticWriteActionSchema.safeParse({
        kind: "createConsultant",
        consultant: { name: "Anna", surname: "Jones", email: "anna.jones@example.com" },
      }).success,
    ).toBe(true);
    expect(
      semanticWriteActionSchema.safeParse({
        kind: "createConsultant",
        consultant: {
          name: "Anna",
          surname: "Jones",
          email: "00000000-0000-4000-8000-000000000001@example.com",
        },
      }).success,
    ).toBe(false);
    expect(
      semanticWriteActionSchema.safeParse({
        kind: "updateConsultant",
        consultant: SELF,
        patch: { email: "00000000-0000-4000-8000-000000000001@example.com" },
      }).success,
    ).toBe(false);

    const attacks = [
      { title: "00000000-0000-4000-8000-000000000001" },
      { title: "api_key=super-secret-value" },
      { client: "Bearer abcdefghijklmnop" },
      { description: "SELECT * FROM consultants" },
      { skills: ["eyJhbGciOiJIUzI1NiJ9.payload.signature"] },
    ];
    for (const fields of attacks) {
      expect(
        semanticWriteActionSchema.safeParse({
          kind: "createDemand",
          demand: { title: "Phoenix", ...fields },
        }).success,
      ).toBe(false);
    }
    expect(
      semanticOutcomeSchema.safeParse({
        type: "clarification",
        intentFamily: "create_consultant",
        knownFacts: { name: "Anna" },
        missing: ["surname"],
        question: "password=do-not-accept",
        reason: "Need a surname.",
      }).success,
    ).toBe(false);
    expect(
      semanticOutcomeSchema.safeParse({
        type: "clarification",
        intentFamily: "create_consultant",
        knownFacts: { title: "SELECT 1" },
        missing: ["surname"],
        question: "What surname?",
        reason: "Bearer abcdefghijklmnop",
      }).success,
    ).toBe(false);
  });

  test("preserves sparse consultant facts for clarification", () => {
    const clarification = {
      type: "clarification",
      intentFamily: "create_consultant",
      knownFacts: { name: "Anna" },
      missing: ["surname", "level", "role"],
      question: "What surname, level, and role should Anna have?",
      reason: "A consultant needs the remaining profile fields before creation.",
    } as const;
    expect(semanticOutcomeSchema.parse(clarification)).toEqual(clarification);
    expect(
      semanticWriteActionSchema.safeParse({
        kind: "createConsultant",
        consultant: { name: "Anna" },
      }).success,
    ).toBe(false);
  });

  test("rejects write authority and invalid closed outcomes", () => {
    const write = {
      type: "write",
      action: { kind: "createDemand", demand: { title: "Phoenix" } },
      confirmed: true,
      previewId: "a".repeat(64),
    };
    expect(semanticOutcomeSchema.safeParse(write).success).toBe(false);
    expect(
      semanticWriteActionSchema.safeParse({
        kind: "updateConsultant",
        consultant: SELF,
        patch: { consultantId: "invented" },
      }).success,
    ).toBe(false);
    expect(
      semanticOutcomeSchema.safeParse({ type: "multiple_changes", changeCount: 1, reason: "one" })
        .success,
    ).toBe(false);
    expect(
      semanticOutcomeSchema.safeParse({
        type: "multiple_changes",
        changeCount: 2,
        reason: "two",
        action: { kind: "setAllocation" },
      }).success,
    ).toBe(false);
    expect(
      semanticOutcomeSchema.safeParse({ type: "unsupported", reason: "invented_reason" }).success,
    ).toBe(false);
    expect(
      semanticConversationOrHelpSchema.safeParse({ type: "conversation_or_help", topic: "sql" })
        .success,
    ).toBe(false);
  });
});
