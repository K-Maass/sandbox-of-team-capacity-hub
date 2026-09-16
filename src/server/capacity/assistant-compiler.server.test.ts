import { describe, expect, test } from "bun:test";

import type { ConversationContext } from "@/domain/capacity/assistant";
import type { CapacityDataSet } from "@/domain/capacity/contracts";
import {
  compileSemanticOutcome,
  tryCompileSemanticOutcome,
  type SemanticCompilerOptions,
} from "./assistant-compiler.server";

const KARIM = "11111111-1111-4111-8111-111111111111";
const MAYA = "22222222-2222-4222-8222-222222222222";
const PHOENIX = "33333333-3333-4333-8333-333333333333";
const BLOCK = "44444444-4444-4444-8444-444444444444";

const consultant = (id: string, name: string, surname: string, isCurrentUser = false) => ({
  id,
  name,
  surname,
  email: `${name.toLowerCase()}@example.com`,
  level: "Consultant" as const,
  role: "Strategy" as const,
  skills: ["AI"],
  workingCapacity: 100,
  archivedAt: null,
  linkedToUser: isCurrentUser,
  isCurrentUser,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const data: CapacityDataSet = {
  consultants: [consultant(KARIM, "Karim", "Maass", true), consultant(MAYA, "Maya", "Singh")],
  demands: [
    {
      id: PHOENIX,
      title: "Phoenix",
      client: "Acme",
      type: "Project",
      status: "Won",
      description: "",
      skills: ["AI"],
      startDate: "2026-09-01",
      endDate: "2026-10-30",
      requiredCapacity: 100,
      owner: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  allocations: [],
  availabilityBlocks: [
    {
      id: BLOCK,
      consultantId: MAYA,
      startDate: "2026-09-19",
      endDate: "2026-09-20",
      note: "Holiday",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const options = (context?: ConversationContext): SemanticCompilerOptions => ({
  data,
  currentUserConsultantId: KARIM,
  currentDate: "2026-09-16",
  context,
});

describe("semantic compiler", () => {
  test("resolves Zurich-oriented date semantics deterministically", () => {
    const nextWeek = compileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getCapacityRange",
          consultant: { kind: "self" },
          range: { kind: "week_offset", weeks: 1 },
          includePipeline: false,
          focus: "free",
        },
      },
      options(),
    );
    expect(nextWeek).toMatchObject({
      type: "read",
      action: {
        consultant: { consultantId: KARIM },
        startDate: "2026-09-21",
        endDate: "2026-09-25",
      },
    });

    const twoWeeks = compileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getTeamOverviewRange",
          range: { kind: "week_range", startWeekOffset: 1, durationWeeks: 2 },
          includePipeline: false,
        },
      },
      options(),
    );
    expect(twoWeeks).toMatchObject({
      action: { startDate: "2026-09-21", endDate: "2026-10-02" },
    });

    const inTwoWeeks = compileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getTeamOverview",
          onDate: { kind: "week_offset", weeks: 2 },
          includePipeline: false,
        },
      },
      options(),
    );
    expect(inTwoWeeks).toMatchObject({ action: { onDate: "2026-09-28" } });

    const friday = compileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getTeamOverview",
          onDate: { kind: "relative_weekday", weekday: "friday" },
          includePipeline: false,
        },
      },
      options(),
    );
    expect(friday).toMatchObject({ action: { onDate: "2026-09-18" } });

    const weekend = compileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getTeamOverview",
          onDate: { kind: "date", date: "2026-09-20" },
          includePipeline: false,
        },
      },
      options(),
    );
    expect(weekend).toMatchObject({ action: { onDate: "2026-09-20" } });
  });

  test("uses the exact current context IDs after revalidation", () => {
    const context: ConversationContext = {
      scope: "consultant",
      lastConsultant: { id: MAYA, label: "stale label" },
      lastRange: { startDate: "2026-09-21", endDate: "2026-09-25" },
    };
    const output = compileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getCapacityRange",
          consultant: { kind: "current_context" },
          range: { kind: "current_context" },
          includePipeline: false,
          focus: "free",
        },
      },
      options(context),
    );
    expect(output).toMatchObject({
      action: {
        consultant: { consultantId: MAYA },
        startDate: "2026-09-21",
        endDate: "2026-09-25",
      },
    });
  });

  test("maps every read family and presentation", () => {
    const outcomes = [
      {
        action: {
          kind: "listConsultants",
          capacityFilter: "available",
          onDate: { kind: "date", date: "2026-09-17" },
        },
        presentation: "available_consultants",
      },
      {
        action: { kind: "getConsultant", consultant: { kind: "name", name: "Maya" } },
        presentation: "default",
      },
      { action: { kind: "listDemands", owner: { kind: "self" } }, presentation: "default" },
      {
        action: {
          kind: "getDemand",
          demand: { kind: "name", name: "Phoenix" },
          focus: "staffing_gap",
        },
        presentation: "staffing_gap",
      },
      {
        action: {
          kind: "getCapacity",
          consultant: { kind: "name", name: "Maya" },
          onDate: { kind: "date", date: "2026-09-17" },
        },
        presentation: "default",
      },
      {
        action: {
          kind: "getCapacityRange",
          consultant: { kind: "self" },
          range: { kind: "week_offset", weeks: 1 },
        },
        presentation: "default",
      },
      {
        action: { kind: "getTeamOverviewRange", range: { kind: "week_offset", weeks: 1 } },
        presentation: "default",
      },
      {
        action: {
          kind: "findAvailabilityWindows",
          range: { kind: "week_offset", weeks: 1 },
          minimumFreeCapacity: 50,
          minimumWorkingDays: 1,
        },
        presentation: "default",
      },
      {
        action: {
          kind: "findStaffingCandidatesRange",
          demand: { kind: "name", name: "Phoenix" },
          range: { kind: "week_offset", weeks: 1 },
        },
        presentation: "default",
      },
      {
        action: {
          kind: "findSuitableDemands",
          consultant: { kind: "self" },
          range: { kind: "week_offset", weeks: 1 },
        },
        presentation: "default",
      },
      {
        action: {
          kind: "skillSupplyDemand",
          range: { kind: "week_offset", weeks: 1 },
          skill: "AI",
        },
        presentation: "default",
      },
      { action: { kind: "productHelp", topic: "freeCapacity" }, presentation: "default" },
      {
        action: {
          kind: "findStaffingCandidates",
          demand: { kind: "name", name: "Phoenix" },
          onDate: { kind: "date", date: "2026-09-17" },
        },
        presentation: "default",
      },
      {
        action: {
          kind: "getTeamOverview",
          onDate: { kind: "date", date: "2026-09-17" },
          focus: "overallocated",
        },
        presentation: "overallocated_consultants",
      },
    ] as const;
    for (const item of outcomes) {
      const output = compileSemanticOutcome({ type: "read", ...item }, options());
      expect(output).toMatchObject({
        type: "read",
        presentation: item.presentation,
        action: { kind: item.action.kind },
      });
    }
  });

  test("derives redundant presentations from semantic action fields", () => {
    const available = compileSemanticOutcome(
      {
        type: "read",
        presentation: "default",
        action: {
          kind: "listConsultants",
          capacityFilter: "available",
          onDate: { kind: "date", date: "2026-09-17" },
        },
      },
      options(),
    );
    expect(available).toMatchObject({ type: "read", presentation: "available_consultants" });

    const staffingGap = compileSemanticOutcome(
      {
        type: "read",
        presentation: "default",
        action: {
          kind: "getDemand",
          demand: { kind: "name", name: "Phoenix" },
          focus: "staffing_gap",
        },
      },
      options(),
    );
    expect(staffingGap).toMatchObject({ type: "read", presentation: "staffing_gap" });
  });

  test("applies canonical consultant and demand defaults", () => {
    const consultantWrite = compileSemanticOutcome(
      {
        type: "write",
        action: { kind: "createConsultant", consultant: { name: "Anna", surname: "Keller" } },
      },
      options(),
    );
    expect(consultantWrite).toMatchObject({
      type: "write",
      action: {
        consultant: {
          level: "Consultant",
          role: "Strategy",
          skills: [],
          workingCapacity: 100,
          email: null,
        },
      },
    });

    const demandWrite = compileSemanticOutcome(
      { type: "write", action: { kind: "createDemand", demand: { title: "Nestle" } } },
      options(),
    );
    expect(demandWrite).toMatchObject({
      type: "write",
      action: {
        demand: {
          title: "Nestle",
          client: "",
          type: "Project",
          status: "Incoming",
          description: "",
          skills: [],
          startDate: null,
          endDate: null,
          requiredCapacity: 100,
          owner: null,
        },
      },
    });
  });

  test("compiles all writes with exact refs and dates", () => {
    const writes = [
      { kind: "updateConsultant", consultant: { kind: "self" }, patch: { role: "Data" } },
      {
        kind: "createDemand",
        demand: {
          title: "New",
          owner: { kind: "self" },
          startDate: { kind: "relative_weekday", weekday: "monday" },
        },
      },
      {
        kind: "updateDemand",
        demand: { kind: "name", name: "Phoenix" },
        patch: {
          owner: { kind: "name", name: "Maya" },
          endDate: { kind: "date", date: "2026-10-30" },
        },
      },
      {
        kind: "setAllocation",
        consultant: { kind: "self" },
        demand: { kind: "name", name: "Phoenix" },
        capacity: 50,
      },
      {
        kind: "removeAllocation",
        consultant: { kind: "name", name: "Maya" },
        demand: { kind: "name", name: "Phoenix" },
      },
      {
        kind: "addAvailabilityBlock",
        consultant: { kind: "name", name: "Maya" },
        startDate: { kind: "date", date: "2026-09-21" },
        endDate: { kind: "date", date: "2026-09-22" },
      },
      {
        kind: "removeAvailabilityBlock",
        block: {
          consultant: { kind: "name", name: "Maya" },
          startDate: { kind: "date", date: "2026-09-19" },
          endDate: { kind: "date", date: "2026-09-20" },
        },
      },
    ] as const;
    for (const action of writes) {
      const output = compileSemanticOutcome({ type: "write", action }, options());
      expect(output).toMatchObject({ type: "write", action: { kind: action.kind } });
    }
  });

  test("compiles all five relative operations without arithmetic", () => {
    const operations = [
      { kind: "adjustConsultantCapacity", consultant: { kind: "self" }, delta: 10 },
      {
        kind: "adjustAllocation",
        consultant: { kind: "self" },
        demand: { kind: "name", name: "Phoenix" },
        delta: 5,
      },
      { kind: "adjustDemandCapacity", demand: { kind: "name", name: "Phoenix" }, delta: 50 },
      {
        kind: "changeConsultantSkill",
        consultant: { kind: "name", name: "Maya" },
        skill: "Cloud",
        operation: "add",
      },
      { kind: "updateConsultantProfile", consultant: { kind: "self" }, role: "Data" },
    ] as const;
    for (const operation of operations) {
      const output = compileSemanticOutcome(
        { type: "relativeWrite", operation, asOf: { kind: "days_from_today", days: 2 } },
        options(),
      );
      expect(output).toMatchObject({
        type: "relativeWrite",
        asOfDate: "2026-09-18",
        operation: { kind: operation.kind },
      });
    }
  });

  test("uses explicit actor linkage instead of isCurrentUser flags for self", () => {
    const actorLinkedData: CapacityDataSet = {
      ...data,
      consultants: data.consultants.map((item) =>
        item.id === MAYA ? { ...item, linkedToUser: true, isCurrentUser: false } : item,
      ),
    };
    const output = compileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getConsultant",
          consultant: { kind: "self" },
        },
      },
      { ...options(), data: actorLinkedData, currentUserConsultantId: MAYA },
    );
    expect(output).toMatchObject({ action: { consultant: { consultantId: MAYA } } });

    const unlinked = tryCompileSemanticOutcome(
      {
        type: "read",
        action: { kind: "getConsultant", consultant: { kind: "self" } },
      },
      { ...options(), currentUserConsultantId: MAYA },
    );
    expect(unlinked).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  test("preserves typed non-actions and produces zero actions", () => {
    expect(
      compileSemanticOutcome(
        { type: "multiple_changes", changeCount: 2, reason: "two changes" },
        options(),
      ),
    ).toMatchObject({ type: "multiple_changes" });
    expect(
      compileSemanticOutcome({ type: "conversation_or_help", topic: "howToUse" }, options()),
    ).toMatchObject({ type: "conversation_or_help" });
    expect(
      compileSemanticOutcome({ type: "unsupported", reason: "outside_capacity_hub" }, options()),
    ).toEqual({ type: "unsupported", reason: "outside_capacity_hub" });
    expect(
      compileSemanticOutcome(
        {
          type: "clarification",
          intentFamily: "create_demand",
          knownFacts: { title: "Phoenix" },
          missing: ["client"],
          question: "Which client?",
          reason: "The client is missing",
        },
        options(),
      ),
    ).toMatchObject({
      type: "clarification",
      knownFacts: { title: "Phoenix" },
      missing: ["client"],
    });
  });

  test("returns candidate errors, context invalidation, and bounded-date errors", () => {
    const duplicateData: CapacityDataSet = {
      ...data,
      consultants: [
        ...data.consultants,
        consultant("55555555-5555-4555-8555-555555555555", "Maya", "Jones"),
      ],
    };
    const ambiguous = tryCompileSemanticOutcome(
      {
        type: "read",
        action: { kind: "getConsultant", consultant: { kind: "name", name: "Maya" } },
      },
      { ...options(), data: duplicateData },
    );
    expect(ambiguous).toMatchObject({
      ok: false,
      error: { code: "AMBIGUOUS_REFERENCE", field: "consultant" },
    });
    if (!ambiguous.ok) expect(ambiguous.error.candidates).toHaveLength(2);

    const invalidContext = tryCompileSemanticOutcome(
      { type: "read", action: { kind: "getConsultant", consultant: { kind: "current_context" } } },
      options({ lastConsultant: { id: "66666666-6666-4666-8666-666666666666", label: "Maya" } }),
    );
    expect(invalidContext).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", field: "context.lastConsultant" },
    });

    const missingContext = tryCompileSemanticOutcome(
      { type: "read", action: { kind: "getConsultant", consultant: { kind: "current_context" } } },
      options(),
    );
    expect(missingContext).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", field: "consultant" },
    });

    const reversed = tryCompileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getCapacityRange",
          consultant: { kind: "self" },
          range: { kind: "range", startDate: "2026-09-25", endDate: "2026-09-21" },
          includePipeline: false,
          focus: "free",
        },
      },
      options(),
    );
    expect(reversed).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    const tooFar = tryCompileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getTeamOverview",
          onDate: { kind: "days_from_today", days: 730 },
          includePipeline: false,
        },
      },
      options(),
    );
    expect(tooFar).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", field: "action.onDate" },
    });
  });

  test("does not accept model IDs or SQL and never mutates the data set", () => {
    const before = structuredClone(data);
    const unsafe = tryCompileSemanticOutcome(
      {
        type: "read",
        action: { kind: "getConsultant", consultant: { kind: "name", name: KARIM } },
      },
      options(),
    );
    expect(unsafe).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const sql = tryCompileSemanticOutcome(
      {
        type: "read",
        action: {
          kind: "getConsultant",
          consultant: { kind: "name", name: "select * from consultants" },
        },
      },
      options(),
    );
    expect(sql).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(data).toEqual(before);
  });
});
