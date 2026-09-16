// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { beforeEach, describe, expect, test } from "bun:test";

import type { ActionPreview, CapacityDataSet, ResolvedAction } from "@/domain/capacity/contracts";
import { assistantRequestSchema, type CapacityIntent } from "@/domain/capacity/assistant";
import { semanticOutcomeSchema } from "@/domain/capacity/assistant-semantic";
import { handleCapacityAssistant } from "./assistant.server";
import type { CapacityRepository, RepositoryMutation } from "./repository";

const ALEX_ONE = "00000000-0000-4000-8000-000000000001";
const ALEX_TWO = "00000000-0000-4000-8000-000000000002";
const ANNA = "00000000-0000-4000-8000-000000000003";
const PHOENIX = "10000000-0000-4000-8000-000000000001";
const ACTOR = "30000000-0000-4000-8000-000000000001";
const VERSION = "2026-09-15T10:00:00.000Z";

function fixture(): CapacityDataSet {
  const consultant = (id: string, name: string, surname: string, workingCapacity = 100) => ({
    id,
    name,
    surname,
    email: null,
    level: "Consultant" as const,
    role: "Strategy" as const,
    skills: ["AI"],
    workingCapacity,
    archivedAt: null,
    linkedToUser: false,
    isCurrentUser: false,
    createdAt: VERSION,
    updatedAt: VERSION,
  });
  return {
    consultants: [
      consultant(ALEX_ONE, "Alex", "Meyer"),
      consultant(ALEX_TWO, "Alex", "Smith"),
      consultant(ANNA, "Anna", "Able", 80),
    ],
    demands: [
      {
        id: PHOENIX,
        title: "Phoenix",
        client: "Client",
        type: "Project",
        status: "Won",
        description: "",
        skills: ["AI"],
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        requiredCapacity: 100,
        owner: null,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ],
    allocations: [],
    availabilityBlocks: [],
  };
}

class MemoryRepository implements CapacityRepository {
  data = fixture();
  applyCount = 0;
  loadCount = 0;

  async load() {
    this.loadCount++;
    return structuredClone(this.data);
  }

  async apply(action: ResolvedAction, preview: ActionPreview): Promise<RepositoryMutation> {
    this.applyCount++;
    if (action.kind === "updateConsultant") {
      const item = this.data.consultants.find((row) => row.id === action.consultantId)!;
      Object.assign(item, action.patch);
      item.updatedAt = "2026-09-15T10:02:00.000Z";
      return { entityId: item.id, changedFields: preview.changes.map((change) => change.field) };
    }
    if (action.kind !== "setAllocation") throw new Error("Unexpected mutation");
    const existing = this.data.allocations.find((item) => item.id === action.allocationId);
    if (existing) {
      existing.capacity = action.capacity;
      existing.updatedAt = "2026-09-15T10:01:00.000Z";
      return { entityId: existing.id, changedFields: ["capacity"] };
    }
    const id = "20000000-0000-4000-8000-000000000001";
    this.data.allocations.push({
      id,
      consultantId: action.consultantId,
      demandId: action.demandId,
      capacity: action.capacity,
      createdAt: VERSION,
      updatedAt: VERSION,
    });
    return { entityId: id, changedFields: preview.changes.map((item) => item.field) };
  }
}

const interpreter = (intent: CapacityIntent) => async () => intent;

const PENDING_CLARIFICATION = {
  intentFamily: "create_consultant" as const,
  knownFacts: { name: "Anna" },
  missing: ["surname", "level", "role"] as const,
  question: "What surname, level, and role should Anna have?",
  reason: "A consultant needs the remaining profile fields before creation.",
};

describe("Capacity assistant orchestration", () => {
  let repository: MemoryRepository;

  beforeEach(() => {
    repository = new MemoryRepository();
  });

  test("request schema accepts bounded pending state for interpret and clarify only", () => {
    const interpret = assistantRequestSchema.parse({
      mode: "interpret",
      message: "Continue",
      pendingClarification: PENDING_CLARIFICATION,
    });
    expect(interpret).toMatchObject({ pendingClarification: PENDING_CLARIFICATION });

    const clarify = assistantRequestSchema.parse({
      mode: "clarify",
      intent: {
        type: "read",
        action: {
          kind: "getConsultant",
          consultant: { name: "Anna" },
          includePipeline: false,
        },
        presentation: "default",
      },
      selections: [{ field: "consultant", candidateId: ANNA }],
      pendingClarification: PENDING_CLARIFICATION,
    });
    expect(clarify).toMatchObject({ pendingClarification: PENDING_CLARIFICATION });

    expect(
      assistantRequestSchema.safeParse({
        mode: "interpret",
        message: "Continue",
        pendingClarification: { ...PENDING_CLARIFICATION, previewId: "a".repeat(64) },
      }).success,
    ).toBe(false);
    expect(
      assistantRequestSchema.safeParse({
        mode: "confirm",
        confirmed: true,
        action: {
          kind: "updateConsultant",
          consultant: { consultantId: ANNA },
          patch: { role: "Data" },
        },
        asOfDate: "2026-09-15",
        previewId: "a".repeat(64),
        pendingClarification: PENDING_CLARIFICATION,
      }).success,
    ).toBe(false);
  });

  test("handler revalidates pending state and returns its cleared result", async () => {
    const response = await handleCapacityAssistant(
      {
        mode: "interpret",
        message: "Who has capacity?",
        pendingClarification: PENDING_CLARIFICATION,
      },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: interpreter({
          type: "read",
          action: {
            kind: "listConsultants",
            status: "active",
            onDate: "2026-09-15",
            includePipeline: false,
          },
          presentation: "default",
        }),
      },
    );
    expect(response).toMatchObject({ ok: true, kind: "read", pendingClarification: null });
    expect(repository.applyCount).toBe(0);
  });

  test("semantic clarification creates pending state through the real handler seam", async () => {
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "Add Anna" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        semanticOutcome: semanticOutcomeSchema.parse({
          type: "clarification",
          intentFamily: "create_consultant",
          knownFacts: { name: "Anna" },
          missing: ["surname", "level", "role"],
          question: "What surname, level, and role should Anna have?",
          reason: "A consultant needs the remaining profile fields before creation.",
        }),
      },
    );
    expect(response).toMatchObject({
      ok: true,
      kind: "semantic_clarification",
      pendingClarification: PENDING_CLARIFICATION,
    });
    expect(repository.applyCount).toBe(0);
  });

  test("semantic clarification replaces pending state and help retains it", async () => {
    const replacementPending = {
      intentFamily: "create_consultant" as const,
      knownFacts: { name: "Anna", surname: "Able" },
      missing: ["level", "role"] as const,
      question: "What level and role should Anna have?",
      reason: "The name and surname are known; the remaining profile fields are required.",
    };
    const replacement = semanticOutcomeSchema.parse({
      type: "clarification",
      intentFamily: "create_consultant",
      knownFacts: replacementPending.knownFacts,
      missing: replacementPending.missing,
      question: replacementPending.question,
      reason: replacementPending.reason,
    });
    const replaced = await handleCapacityAssistant(
      {
        mode: "interpret",
        message: "Anna Able",
        pendingClarification: PENDING_CLARIFICATION,
      },
      repository,
      ACTOR,
      { currentDate: "2026-09-15", semanticOutcome: replacement },
    );
    expect(replaced).toMatchObject({
      ok: true,
      kind: "semantic_clarification",
      pendingClarification: replacementPending,
    });

    const retained = await handleCapacityAssistant(
      {
        mode: "interpret",
        message: "Can you explain the clarification?",
        pendingClarification: replacementPending,
      },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        semanticOutcome: semanticOutcomeSchema.parse({
          type: "conversation_or_help",
          topic: "clarification",
        }),
      },
    );
    expect(retained).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_OUTCOME_NOT_ROUTED" },
      pendingClarification: replacementPending,
    });
  });

  test("handler rejects tampered pending state before action execution", async () => {
    const tamperedRequest = {
      mode: "interpret" as const,
      message: "Continue",
      pendingClarification: { ...PENDING_CLARIFICATION, previewId: "a".repeat(64) },
    };
    // @ts-expect-error -- deliberately exercises the runtime trust boundary with tampered input.
    const response = await handleCapacityAssistant(tamperedRequest, repository, ACTOR, {
      currentDate: "2026-09-15",
      interpret: interpreter({
        type: "unsupported",
        reason: "outside_capacity_hub",
      }),
    });
    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_PENDING_CLARIFICATION" },
      pendingClarification: null,
    });
    expect(repository.loadCount).toBe(0);
    expect(repository.applyCount).toBe(0);
  });

  test("executes deterministic reads and filters available consultants", async () => {
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "Who has capacity?" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: interpreter({
          type: "read",
          action: {
            kind: "listConsultants",
            status: "active",
            onDate: "2026-09-15",
            includePipeline: false,
          },
          presentation: "available_consultants",
        }),
      },
    );
    expect(response).toMatchObject({ ok: true, kind: "read" });
    if (response.ok && response.kind === "read" && response.details.kind === "people") {
      expect(response.details.rows).toHaveLength(3);
      expect(response.details.rows[0].name).toBe("Alex Meyer");
    }
    expect(repository.applyCount).toBe(0);
  });

  test("a write interpretation only previews, then confirmation delegates and mutates once", async () => {
    const intent = {
      type: "write",
      action: {
        kind: "setAllocation",
        consultant: { name: "Anna Able" },
        demand: { title: "Phoenix" },
        capacity: 50,
      },
      asOfDate: "2026-09-15",
    } as const;
    const previewResponse = await handleCapacityAssistant(
      { mode: "interpret", message: "Assign Anna" },
      repository,
      ACTOR,
      { currentDate: "2026-09-15", interpret: interpreter(intent) },
    );
    expect(previewResponse).toMatchObject({ ok: true, kind: "preview" });
    expect(repository.applyCount).toBe(0);
    if (!previewResponse.ok || previewResponse.kind !== "preview")
      throw new Error("Expected preview");

    const confirmed = await handleCapacityAssistant(
      {
        mode: "confirm",
        confirmed: true,
        action: previewResponse.action,
        asOfDate: previewResponse.preview.asOfDate,
        previewId: previewResponse.preview.previewId,
      },
      repository,
      ACTOR,
      { currentDate: "2026-09-15" },
    );
    expect(confirmed).toMatchObject({
      ok: true,
      kind: "executed",
      success: { result: { changed: true } },
    });
    expect(repository.applyCount).toBe(1);
    expect(repository.data.allocations[0]).toMatchObject({
      consultantId: ANNA,
      demandId: PHOENIX,
      capacity: 50,
    });

    const repeated = await handleCapacityAssistant(
      {
        mode: "confirm",
        confirmed: true,
        action: previewResponse.action,
        asOfDate: previewResponse.preview.asOfDate,
        previewId: previewResponse.preview.previewId,
      },
      repository,
      ACTOR,
      { currentDate: "2026-09-15" },
    );
    expect(repeated).toMatchObject({ ok: false, error: { code: "STALE_PREVIEW" } });
    expect(repository.applyCount).toBe(1);
  });

  test("revalidates ambiguity choices before producing a write preview", async () => {
    const intent = {
      type: "write",
      action: {
        kind: "setAllocation",
        consultant: { name: "Alex" },
        demand: { title: "Phoenix" },
        capacity: 50,
      },
      asOfDate: "2026-09-15",
    } as const;
    const first = await handleCapacityAssistant(
      {
        mode: "interpret",
        message: "Assign Alex",
        pendingClarification: PENDING_CLARIFICATION,
      },
      repository,
      ACTOR,
      { currentDate: "2026-09-15", interpret: interpreter(intent) },
    );
    expect(first).toMatchObject({
      ok: true,
      kind: "clarification",
      field: "consultant",
      pendingClarification: PENDING_CLARIFICATION,
    });
    if (!first.ok || first.kind !== "clarification") throw new Error("Expected clarification");

    const chosen = await handleCapacityAssistant(
      {
        mode: "clarify",
        intent: first.intent,
        selections: [{ field: first.field, candidateId: ALEX_ONE }],
        pendingClarification: PENDING_CLARIFICATION,
      },
      repository,
      ACTOR,
      { currentDate: "2026-09-15" },
    );
    expect(chosen).toMatchObject({ ok: true, kind: "preview", pendingClarification: null });
    expect(repository.applyCount).toBe(0);

    const tampered = await handleCapacityAssistant(
      {
        mode: "clarify",
        intent: first.intent,
        selections: [{ field: first.field, candidateId: ANNA }],
      },
      repository,
      ACTOR,
      { currentDate: "2026-09-15" },
    );
    expect(tampered).toMatchObject({ ok: false, error: { code: "CLARIFICATION_STALE" } });
  });

  test("relative ambiguity uses the normal candidate flow before compiling arithmetic", async () => {
    repository.data.consultants[0].workingCapacity = 50;
    const relative: CapacityIntent = {
      type: "relativeWrite",
      operation: {
        kind: "adjustConsultantCapacity",
        consultant: { name: "Alex" },
        delta: 10,
      },
      asOfDate: "2026-09-15",
    };
    const first = await handleCapacityAssistant(
      { mode: "interpret", message: "Increase Alex by 10%" },
      repository,
      ACTOR,
      { currentDate: "2026-09-15", interpret: interpreter(relative) },
    );
    expect(first).toMatchObject({ ok: true, kind: "clarification", field: "consultant" });
    if (!first.ok || first.kind !== "clarification") throw new Error("Expected clarification");
    const selected = await handleCapacityAssistant(
      {
        mode: "clarify",
        intent: first.intent,
        selections: [{ field: first.field, candidateId: ALEX_ONE }],
      },
      repository,
      ACTOR,
      { currentDate: "2026-09-15" },
    );
    expect(selected).toMatchObject({
      ok: true,
      kind: "preview",
      preview: { changes: [{ after: 60 }] },
    });
    expect(repository.applyCount).toBe(0);
  });

  test("unsupported intent cannot reach the repository mutation path", async () => {
    const response = await handleCapacityAssistant(
      {
        mode: "interpret",
        message: "Delete everyone",
        pendingClarification: PENDING_CLARIFICATION,
      },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: interpreter({ type: "unsupported", reason: "destructive_action" }),
      },
    );
    expect(response).toMatchObject({ ok: true, kind: "unsupported", pendingClarification: null });
    expect(repository.applyCount).toBe(0);
  });

  test("compound mutation requests are refused without a partial preview", async () => {
    for (const message of [
      "Set Phoenix to Won and assign Karim 50%.",
      "Put Karim 50% and Maya 40% on Phoenix.",
      "Create Apollo, then assign Karim 50%.",
      "Explain pipeline and set Apollo to Won.",
    ]) {
      const response = await handleCapacityAssistant(
        { mode: "interpret", message },
        repository,
        ACTOR,
        { currentDate: "2026-09-15" },
      );
      expect(response).toMatchObject({ ok: true, kind: "unsupported", reason: "multiple_changes" });
    }
    expect(repository.applyCount).toBe(0);
  });

  test("rebases a relative consultant update after a concurrent current-state change", async () => {
    let loads = 0;
    const changingRepository: CapacityRepository = {
      async load() {
        loads += 1;
        if (loads === 2) repository.data.consultants[1].workingCapacity = 70;
        return structuredClone(repository.data);
      },
      apply: (action, preview, actor) => repository.apply(action, preview, actor),
    };
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "Increase Alex by 10%" },
      changingRepository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: async () => ({
          type: "relativeWrite",
          operation: {
            kind: "adjustConsultantCapacity",
            consultant: { name: "Alex Smith" },
            delta: 10,
          },
          asOfDate: "2026-09-15",
        }),
      },
    );
    expect(response).toMatchObject({
      ok: true,
      kind: "preview",
      preview: { changes: [{ after: 80 }] },
    });
    expect(repository.applyCount).toBe(0);
  });

  test("rejects a change injected immediately before the authoritative Phase 2 preview read", async () => {
    repository.data.consultants[1].workingCapacity = 50;
    let loads = 0;
    const raceRepository: CapacityRepository = {
      async load() {
        loads += 1;
        if (loads === 4) repository.data.consultants[1].workingCapacity = 70;
        return structuredClone(repository.data);
      },
      apply: (action, preview, actor) => repository.apply(action, preview, actor),
    };
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "Increase Alex by 10%" },
      raceRepository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: async () => ({
          type: "relativeWrite",
          operation: {
            kind: "adjustConsultantCapacity",
            consultant: { name: "Alex Smith" },
            delta: 10,
          },
          asOfDate: "2026-09-15",
        }),
      },
    );
    expect(response).toMatchObject({ ok: false, error: { code: "STALE_PREVIEW" } });
    expect(repository.applyCount).toBe(0);
  });

  test("resolves relative me/my references through the authenticated consultant", async () => {
    repository.data.consultants[0].workingCapacity = 60;
    repository.data.consultants[0].linkedToUser = true;
    repository.data.consultants[0].isCurrentUser = true;
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "Increase my capacity by 10%" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: async () => ({
          type: "relativeWrite",
          operation: { kind: "adjustConsultantCapacity", consultant: { name: "me" }, delta: 10 },
          asOfDate: "2026-09-15",
        }),
      },
    );
    expect(response).toMatchObject({
      ok: true,
      kind: "preview",
      preview: { changes: [{ after: 70 }] },
    });
  });

  test("resolves self-reference reads through the linked consultant profile", async () => {
    repository.data.consultants[0].linkedToUser = true;
    repository.data.consultants[0].isCurrentUser = true;
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "How much capacity do I have next week?" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: interpreter({
          type: "read",
          action: {
            kind: "getCapacityRange",
            consultant: { name: "me" },
            startDate: "2026-09-21",
            endDate: "2026-09-25",
            includePipeline: false,
            focus: "free",
          },
          presentation: "default",
        }),
      },
    );
    expect(response).toMatchObject({ ok: true, kind: "read", context: { scope: "consultant" } });
    if (response.ok && response.kind === "read")
      expect(response.context?.lastConsultant?.id).toBe(ALEX_ONE);
  });

  test("team scope clears consultant context rather than merging subjects", async () => {
    const response = await handleCapacityAssistant(
      {
        mode: "interpret",
        message: "How much free capacity does the team have?",
        context: {
          scope: "consultant",
          lastConsultant: { id: ALEX_TWO, label: "Alex Smith" },
          lastRange: { startDate: "2026-09-15", endDate: "2026-09-15" },
        },
      },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: async () => ({
          type: "read",
          action: { kind: "getTeamOverview", onDate: "2026-09-15", includePipeline: false },
          presentation: "default",
        }),
      },
    );
    expect(response).toMatchObject({ ok: true, kind: "read", context: { scope: "team" } });
    if (response.ok && response.kind === "read")
      expect(response.context?.lastConsultant).toBeUndefined();
  });

  test("weekend-only team ranges explain that no working days are present", async () => {
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "What is the team capacity Saturday and Sunday?" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: interpreter({
          type: "read",
          action: {
            kind: "getTeamOverviewRange",
            startDate: "2026-09-19",
            endDate: "2026-09-20",
            includePipeline: false,
            focus: "free",
          },
          presentation: "default",
        }),
      },
    );
    expect(response).toMatchObject({ ok: true, kind: "read" });
    if (response.ok && response.kind === "read") {
      expect(response.message).toContain("no Monday–Friday working days");
      expect(response.message).not.toMatch(/0%.*0%/);
      expect(response.details).toMatchObject({ kind: "rangeOverview", days: [] });
    }
  });

  test("refreshes context display metadata from the exact authoritative selector", async () => {
    repository.data.consultants[0].email = "alex@example.com";
    const response = await handleCapacityAssistant(
      {
        mode: "interpret",
        message: "Why?",
        pendingClarification: PENDING_CLARIFICATION,
        context: {
          scope: "consultant",
          lastConsultant: { id: ALEX_ONE, label: "Wrong Alex", disambiguator: "stale@example.com" },
          lastRange: { startDate: "2026-09-15", endDate: "2026-09-15" },
          lastFocus: "free",
        },
      },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: async () => ({
          type: "read",
          action: {
            kind: "getCapacity",
            consultant: { consultantId: ALEX_ONE },
            onDate: "2026-09-15",
            includePipeline: false,
            focus: "breakdown",
          },
          presentation: "default",
        }),
      },
    );
    expect(response).toMatchObject({
      ok: true,
      context: {
        lastConsultant: { id: ALEX_ONE, label: "Alex Meyer", disambiguator: "alex@example.com" },
      },
      pendingClarification: null,
    });
  });

  test("returns an authoritative cleared context when the selector disappears", async () => {
    const response = await handleCapacityAssistant(
      {
        mode: "interpret",
        message: "Why?",
        pendingClarification: PENDING_CLARIFICATION,
        context: {
          scope: "consultant",
          lastConsultant: { id: "99999999-9999-4999-8999-999999999999", label: "Alex Smith" },
        },
      },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: async () => ({
          type: "read",
          action: { kind: "getTeamOverview", onDate: "2026-09-15", includePipeline: false },
          presentation: "default",
        }),
      },
    );
    expect(response).toMatchObject({
      ok: false,
      error: { code: "CONTEXT_INVALIDATED" },
      context: {},
      pendingClarification: null,
    });
  });
});
