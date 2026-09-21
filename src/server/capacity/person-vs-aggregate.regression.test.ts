// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import type { ConversationContext } from "@/domain/capacity/assistant";
import { semanticOutcomeSchema } from "@/domain/capacity/assistant-semantic";
import type {
  ActionPreview,
  CapacityDataSet,
  ResolvedAction,
} from "@/domain/capacity/contracts";
import { CapacityActionFailure } from "@/domain/capacity/errors";
import { compileSemanticOutcome } from "./assistant-compiler.server";
import { projectSafeSemanticContext } from "./assistant-prompt.server";
import { handleCapacityAssistant } from "./assistant.server";
import type { CapacityRepository, RepositoryMutation } from "./repository";

const ACTOR = "99999999-9999-4999-8999-999999999999";
const KARIM = "11111111-1111-4111-8111-111111111111";
const MAYA = "22222222-2222-4222-8222-222222222222";
const ALEX = "33333333-3333-4333-8333-333333333333";
const DEMAND = "44444444-4444-4444-8444-444444444444";
const ALLOCATION = "55555555-5555-4555-8555-555555555555";
const VERSION = "2026-09-21T10:00:00.000Z";

function fixture(): CapacityDataSet {
  return {
    consultants: [
      {
        id: KARIM,
        name: "Karim",
        surname: "Maass",
        email: "karim@example.com",
        level: "Consultant",
        role: "Strategy",
        skills: ["AI"],
        workingCapacity: 100,
        archivedAt: null,
        linkedToUser: true,
        isCurrentUser: true,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
      {
        id: MAYA,
        name: "Maya",
        surname: "Keller",
        email: "maya@example.com",
        level: "Senior",
        role: "Data",
        skills: ["AI"],
        workingCapacity: 80,
        archivedAt: null,
        linkedToUser: false,
        isCurrentUser: false,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
      {
        id: ALEX,
        name: "Alex",
        surname: "Zero",
        email: "alex@example.com",
        level: "Consultant",
        role: "Engineering",
        skills: ["AI"],
        workingCapacity: 0,
        archivedAt: null,
        linkedToUser: false,
        isCurrentUser: false,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ],
    demands: [
      {
        id: DEMAND,
        title: "Alpha",
        client: "Acme",
        type: "Project",
        status: "Won",
        description: "",
        skills: ["AI"],
        startDate: "2026-09-01",
        endDate: "2026-10-31",
        requiredCapacity: 100,
        owner: null,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ],
    allocations: [
      {
        id: ALLOCATION,
        demandId: DEMAND,
        consultantId: KARIM,
        capacity: 40,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ],
    availabilityBlocks: [],
  };
}

class ReadOnlyRepository implements CapacityRepository {
  constructor(public data: CapacityDataSet = fixture()) {}

  async load(): Promise<CapacityDataSet> {
    return structuredClone(this.data);
  }

  async apply(
    _action: ResolvedAction,
    _preview: ActionPreview,
    _actorUserId: string,
  ): Promise<RepositoryMutation> {
    throw new Error("Unexpected mutation in read-only regression test");
  }
}

function semantic(value: unknown) {
  return semanticOutcomeSchema.parse(value);
}

describe("person-vs-aggregate capacity semantics", () => {
  test("projects one-day context as point time and keeps multi-day context as a range", () => {
    expect(
      projectSafeSemanticContext({
        context: {
          scope: "team",
          lastRange: { startDate: "2026-09-29", endDate: "2026-09-29" },
          lastFocus: "free",
        },
      }),
    ).toEqual({ scope: "team", onDate: "2026-09-29", focus: "free" });

    expect(
      projectSafeSemanticContext({
        context: {
          scope: "team",
          lastRange: { startDate: "2026-09-28", endDate: "2026-10-02" },
          lastFocus: "free",
        },
      }),
    ).toEqual({
      scope: "team",
      range: { startDate: "2026-09-28", endDate: "2026-10-02" },
      focus: "free",
    });
  });

  test("refuses to collapse a multi-day current context into a point date", () => {
    const outcome = semantic({
      type: "read",
      action: {
        kind: "listConsultants",
        onDate: { kind: "current_context" },
        capacityFilter: "available",
      },
    });
    try {
      compileSemanticOutcome(outcome, {
        data: fixture(),
        currentDate: "2026-09-21",
        currentUserConsultantId: KARIM,
        context: {
          scope: "team",
          lastRange: { startDate: "2026-09-28", endDate: "2026-10-02" },
          lastFocus: "free",
        },
      });
      throw new Error("Expected compiler to reject range-as-point context");
    } catch (error) {
      expect(error).toBeInstanceOf(CapacityActionFailure);
      expect((error as CapacityActionFailure).detail).toMatchObject({
        code: "VALIDATION_ERROR",
        field: "action.onDate",
      });
    }
  });

  test("returns named consultants for range availability instead of aggregate team totals", async () => {
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "Who has room next week?" },
      new ReadOnlyRepository(),
      ACTOR,
      {
        currentDate: "2026-09-21",
        useV2Reads: true,
        interpretV2: async () =>
          semantic({
            type: "read",
            action: {
              kind: "listConsultantsRange",
              range: { kind: "range", startDate: "2026-09-28", endDate: "2026-10-02" },
              includePipeline: false,
              capacityFilter: "available",
            },
          }),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      kind: "read",
      details: {
        kind: "rangePeople",
        startDate: "2026-09-28",
        endDate: "2026-10-02",
        rows: [
          { id: MAYA, name: "Maya Keller", minimumFree: 80 },
          { id: KARIM, name: "Karim Maass", minimumFree: 60 },
        ],
      },
      context: {
        scope: "team",
        lastRange: { startDate: "2026-09-28", endDate: "2026-10-02" },
        lastFocus: "free",
      },
    });
  });

  test("switches an aggregate point follow-up to people while preserving the exact date", async () => {
    const repository = new ReadOnlyRepository();
    const first = await handleCapacityAssistant(
      { mode: "interpret", message: "How much capacity do we have next Tuesday?" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-21",
        useV2Reads: true,
        interpretV2: async () =>
          semantic({
            type: "read",
            action: {
              kind: "getTeamOverview",
              onDate: { kind: "date", date: "2026-09-29" },
              includePipeline: false,
            },
          }),
      },
    );
    expect(first).toMatchObject({
      ok: true,
      kind: "read",
      details: { kind: "overview", onDate: "2026-09-29" },
      context: {
        scope: "team",
        lastRange: { startDate: "2026-09-29", endDate: "2026-09-29" },
        lastFocus: "free",
      },
    });
    if (!first.ok || !first.context) throw new Error("Expected point context");

    const second = await handleCapacityAssistant(
      {
        mode: "interpret",
        message: "Who specifically?",
        context: first.context as ConversationContext,
      },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-21",
        useV2Reads: true,
        interpretV2: async () =>
          semantic({
            type: "read",
            action: {
              kind: "listConsultants",
              onDate: { kind: "current_context" },
              includePipeline: false,
              capacityFilter: "available",
            },
          }),
      },
    );

    expect(second).toMatchObject({
      ok: true,
      kind: "read",
      details: {
        kind: "people",
        onDate: "2026-09-29",
        rows: [
          { id: MAYA, name: "Maya Keller", availableCapacity: 80 },
          { id: KARIM, name: "Karim Maass", availableCapacity: 60 },
        ],
      },
      context: {
        scope: "team",
        lastRange: { startDate: "2026-09-29", endDate: "2026-09-29" },
        lastFocus: "free",
      },
    });
  });
});
