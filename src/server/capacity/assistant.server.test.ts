// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { beforeEach, describe, expect, test } from "bun:test";

import type { ActionPreview, CapacityDataSet, ResolvedAction } from "@/domain/capacity/contracts";
import {
  assistantRequestSchema,
  type CapacityIntent,
  type ConversationContext,
} from "@/domain/capacity/assistant";
import { semanticOutcomeSchema } from "@/domain/capacity/assistant-semantic";
import { compileSemanticOutcome } from "./assistant-compiler.server";
import { CapacityV2InterpreterError } from "./assistant-interpreter-v2.server";
import { handleCapacityAssistant } from "./assistant.server";
import type { CapacityRepository, RepositoryMutation } from "./repository";

const ALEX_ONE = "00000000-0000-4000-8000-000000000001";
const ALEX_TWO = "00000000-0000-4000-8000-000000000002";
const ANNA = "00000000-0000-4000-8000-000000000003";
const MAYA = "00000000-0000-4000-8000-000000000004";
const KARIM = "00000000-0000-4000-8000-000000000005";
const PHOENIX = "10000000-0000-4000-8000-000000000001";
const PHOENIX_TWO = "10000000-0000-4000-8000-000000000002";
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
      ok: true,
      kind: "conversation_or_help",
      topic: "clarification",
      pendingClarification: replacementPending,
    });
    if (retained.ok && retained.kind === "conversation_or_help") {
      expect(retained.message).toContain("Outstanding fields: level, role.");
    }
  });

  test("routes the semantic clarification lifecycle without previewing or mutating", async () => {
    repository.data.consultants.push({
      ...repository.data.consultants[0],
      id: KARIM,
      name: "Karim",
      surname: "Maass",
    });
    const withV2 = (outcome: unknown, pendingClarification?: typeof PENDING_CLARIFICATION) =>
      handleCapacityAssistant(
        {
          mode: "interpret",
          message: "synthetic semantic continuation",
          ...(pendingClarification ? { pendingClarification } : {}),
        },
        repository,
        ACTOR,
        {
          currentDate: "2026-09-15",
          useV2Reads: true,
          interpretV2: async () => semanticOutcomeSchema.parse(outcome),
        },
      );

    const initial = await withV2({
      type: "clarification",
      intentFamily: "create_consultant",
      knownFacts: { name: "Anna" },
      missing: ["surname", "level", "role"],
      question: "What surname, level, and role should Anna have?",
      reason: "A consultant needs the remaining profile fields before creation.",
    });
    expect(initial).toMatchObject({ ok: true, kind: "semantic_clarification" });
    if (!initial.ok || initial.kind !== "semantic_clarification")
      throw new Error("Expected pending");

    const help = await withV2(
      { type: "conversation_or_help", topic: "clarification" },
      initial.pendingClarification ?? undefined,
    );
    expect(help).toMatchObject({
      ok: true,
      kind: "conversation_or_help",
      topic: "clarification",
      pendingClarification: initial.pendingClarification,
    });
    if (help.ok && help.kind === "conversation_or_help") {
      expect(help.message).toContain("Outstanding fields: surname, level, role.");
    }

    const completed = await withV2(
      {
        type: "write",
        action: {
          kind: "createConsultant",
          consultant: { name: "Anna", surname: "Able", level: "Consultant", role: "Strategy" },
        },
      },
      help.pendingClarification ?? undefined,
    );
    expect(completed).toMatchObject({
      ok: false,
      error: { code: "V2_WRITE_CUTOVER_NOT_READY" },
      pendingClarification: null,
    });

    const unrelatedRead = await withV2(
      {
        type: "read",
        action: { kind: "getConsultant", consultant: { kind: "name", name: "Karim" } },
      },
      help.pendingClarification ?? undefined,
    );
    expect(unrelatedRead).toMatchObject({
      ok: true,
      kind: "read",
      pendingClarification: null,
      details: { kind: "people", rows: [{ name: "Karim Maass" }] },
    });

    const unsupported = await withV2({
      type: "unsupported",
      reason: "partial_day_availability",
    });
    expect(unsupported).toMatchObject({
      ok: true,
      kind: "unsupported",
      reason: "partial_day_availability",
      pendingClarification: null,
    });

    const compound = await withV2({
      type: "multiple_changes",
      changeCount: 2,
      reason: "Two changes were requested.",
    });
    expect(compound).toMatchObject({ ok: true, kind: "multiple_changes", changeCount: 2 });
    expect(repository.applyCount).toBe(0);
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

  test("V2 read cutover compiles self reads through the existing read presentation", async () => {
    repository.data.consultants[0].linkedToUser = true;
    repository.data.consultants[0].isCurrentUser = true;
    let legacyCalls = 0;
    let compilerCurrentUserId: string | undefined;
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "How much am I taken?" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        useV2Reads: true,
        interpret: async () => {
          legacyCalls += 1;
          throw new Error("V1 must not be called");
        },
        interpretV2: async (_message, _date, interpreterOptions) => {
          expect(interpreterOptions).not.toHaveProperty("currentUserConsultantId");
          return semanticOutcomeSchema.parse({
            type: "read",
            action: {
              kind: "getCapacity",
              consultant: { kind: "self" },
              onDate: { kind: "date", date: "2026-09-15" },
              includePipeline: false,
              focus: "committed",
            },
          });
        },
        compileV2: (outcome, compilerOptions) => {
          compilerCurrentUserId = compilerOptions.currentUserConsultantId;
          return compileSemanticOutcome(outcome, compilerOptions);
        },
      },
    );
    expect(response).toMatchObject({ ok: true, kind: "read", details: { kind: "capacity" } });
    expect(compilerCurrentUserId).toBe(ALEX_ONE);
    expect(legacyCalls).toBe(0);
    expect(repository.applyCount).toBe(0);

    const legacy = await handleCapacityAssistant(
      { mode: "interpret", message: "legacy equivalent" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: async () => ({
          type: "read",
          action: {
            kind: "getCapacity",
            consultant: { name: "me" },
            onDate: "2026-09-15",
            includePipeline: false,
            focus: "committed",
          },
          presentation: "default",
        }),
      },
    );
    if (response.ok && response.kind === "read" && legacy.ok && legacy.kind === "read") {
      expect({
        message: response.message,
        details: response.details,
        context: response.context,
      }).toEqual({ message: legacy.message, details: legacy.details, context: legacy.context });
    }
  });

  test("V2 preserves context, range, focus, weekend, and open-ended Phase 2 semantics", async () => {
    repository.data.consultants[0].linkedToUser = true;
    repository.data.consultants[0].isCurrentUser = true;
    repository.data.consultants.push({
      ...repository.data.consultants[0],
      id: MAYA,
      name: "Maya",
      surname: "Singh",
      email: "maya@example.com",
      linkedToUser: false,
      isCurrentUser: false,
    });
    repository.data.demands.push({
      ...repository.data.demands[0],
      id: "10000000-0000-4000-8000-000000000002",
      title: "Open-ended",
      startDate: null,
      endDate: null,
    });
    const outcomes = new Map([
      [
        "taken",
        semanticOutcomeSchema.parse({
          type: "read",
          action: {
            kind: "getCapacity",
            consultant: { kind: "self" },
            onDate: { kind: "date", date: "2026-09-15" },
            includePipeline: false,
            focus: "committed",
          },
        }),
      ],
      [
        "pipeline",
        semanticOutcomeSchema.parse({
          type: "read",
          action: {
            kind: "getCapacity",
            consultant: { kind: "current_context" },
            onDate: { kind: "current_context" },
            includePipeline: true,
            focus: "pipeline",
          },
        }),
      ],
      [
        "why",
        semanticOutcomeSchema.parse({
          type: "read",
          action: {
            kind: "getCapacity",
            consultant: { kind: "current_context" },
            onDate: { kind: "current_context" },
            includePipeline: true,
            focus: "breakdown",
          },
        }),
      ],
      [
        "projects",
        semanticOutcomeSchema.parse({
          type: "read",
          action: { kind: "getConsultant", consultant: { kind: "self" }, includePipeline: false },
        }),
      ],
      [
        "Maya",
        semanticOutcomeSchema.parse({
          type: "read",
          action: { kind: "getConsultant", consultant: { kind: "name", name: "Maya" } },
        }),
      ],
    ]);
    const ask = (message: string, context?: ConversationContext) =>
      handleCapacityAssistant(
        { mode: "interpret", message, ...(context ? { context } : {}) },
        repository,
        ACTOR,
        {
          currentDate: "2026-09-15",
          useV2Reads: true,
          interpretV2: async (input) => outcomes.get(input)!,
        },
      );

    const taken = await ask("taken");
    expect(taken).toMatchObject({
      ok: true,
      context: {
        scope: "consultant",
        lastConsultant: { id: ALEX_ONE },
        lastRange: { startDate: "2026-09-15", endDate: "2026-09-15" },
        lastFocus: "committed",
      },
    });
    const pipeline = await ask("pipeline", taken.ok ? taken.context : undefined);
    expect(pipeline).toMatchObject({
      ok: true,
      context: {
        scope: "consultant",
        lastConsultant: { id: ALEX_ONE },
        lastRange: { startDate: "2026-09-15", endDate: "2026-09-15" },
        lastFocus: "pipeline",
        includePipeline: true,
      },
    });
    const why = await ask("why", pipeline.ok ? pipeline.context : undefined);
    expect(why).toMatchObject({
      ok: true,
      context: { lastFocus: "breakdown", explainFocus: "pipeline" },
    });
    const projects = await ask("projects", why.ok ? why.context : undefined);
    expect(projects).toMatchObject({ ok: true, context: { lastFocus: "allocations" } });
    const maya = await ask("Maya", projects.ok ? projects.context : undefined);
    expect(maya).toMatchObject({ ok: true, context: { lastConsultant: { id: MAYA } } });

    const weekend = await handleCapacityAssistant(
      { mode: "interpret", message: "weekend" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        useV2Reads: true,
        interpretV2: async () =>
          semanticOutcomeSchema.parse({
            type: "read",
            action: {
              kind: "getTeamOverviewRange",
              range: { kind: "range", startDate: "2026-09-19", endDate: "2026-09-20" },
              includePipeline: false,
              focus: "free",
            },
          }),
      },
    );
    expect(weekend).toMatchObject({ ok: true, details: { kind: "rangeOverview", days: [] } });

    const openEnded = await handleCapacityAssistant(
      { mode: "interpret", message: "open-ended" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        useV2Reads: true,
        interpretV2: async () =>
          semanticOutcomeSchema.parse({
            type: "read",
            action: {
              kind: "listDemands",
              activeOn: { kind: "date", date: "2026-09-15" },
              includeClosed: true,
            },
          }),
      },
    );
    expect(openEnded).toMatchObject({ ok: true, details: { kind: "demands" } });
    if (openEnded.ok && openEnded.kind === "read" && openEnded.details.kind === "demands")
      expect(openEnded.details.rows.some((row) => row.title === "Open-ended")).toBe(true);
    expect(repository.applyCount).toBe(0);
  });

  test("V2 duplicate names use authoritative candidate clarification", async () => {
    let legacyCalls = 0;
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "Mysterious Alex" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        useV2Reads: true,
        interpret: async () => {
          legacyCalls += 1;
          throw new Error("V1 must not be called");
        },
        interpretV2: async () =>
          semanticOutcomeSchema.parse({
            type: "read",
            action: {
              kind: "getConsultant",
              consultant: { kind: "name", name: "Alex" },
            },
          }),
      },
    );
    expect(response).toMatchObject({
      ok: true,
      kind: "clarification",
      field: "consultant",
      candidates: [{ id: ALEX_ONE }, { id: ALEX_TWO }],
      intent: { type: "read", action: { kind: "getConsultant", consultant: { name: "Alex" } } },
    });
    expect(legacyCalls).toBe(0);
    expect(repository.applyCount).toBe(0);
  });

  test("V2 duplicate demand reads use authoritative candidate clarification", async () => {
    repository.data.demands.push({
      ...repository.data.demands[0],
      id: PHOENIX_TWO,
      client: "Other Client",
    });
    let legacyCalls = 0;
    const outcomes = [
      {
        kind: "getDemand" as const,
        demand: { kind: "name" as const, name: "Phoenix" },
        onDate: { kind: "date" as const, date: "2026-09-15" },
      },
      {
        kind: "findStaffingCandidatesRange" as const,
        demand: { kind: "name" as const, name: "Phoenix" },
        range: { kind: "range" as const, startDate: "2026-09-15", endDate: "2026-09-19" },
        includePipeline: false,
        minimumSkillMatches: 0,
        limit: 20,
      },
    ];

    for (const action of outcomes) {
      const response = await handleCapacityAssistant(
        { mode: "interpret", message: "Which Phoenix?" },
        repository,
        ACTOR,
        {
          currentDate: "2026-09-15",
          useV2Reads: true,
          interpret: async () => {
            legacyCalls += 1;
            throw new Error("V1 must not be called");
          },
          interpretV2: async () => semanticOutcomeSchema.parse({ type: "read", action }),
        },
      );
      expect(response).toMatchObject({
        ok: true,
        kind: "clarification",
        field: "demand",
        candidates: [{ id: PHOENIX }, { id: PHOENIX_TWO }],
      });
    }
    expect(legacyCalls).toBe(0);
    expect(repository.applyCount).toBe(0);
  });

  test("V2 failures, writes, compound outcomes, and compile failures never call V1", async () => {
    let legacyCalls = 0;
    const base = {
      currentDate: "2026-09-15",
      useV2Reads: true,
      interpret: async () => {
        legacyCalls += 1;
        throw new Error("V1 must not be called");
      },
    };
    await expect(
      handleCapacityAssistant({ mode: "interpret", message: "provider fails" }, repository, ACTOR, {
        ...base,
        interpretV2: async () => {
          throw new CapacityV2InterpreterError(
            "CAPACITY_V2_PROVIDER_ERROR",
            "provider_unavailable",
          );
        },
      }),
    ).rejects.toMatchObject({ code: "CAPACITY_V2_PROVIDER_ERROR" });

    const clarification = await handleCapacityAssistant(
      { mode: "interpret", message: "need clarification" },
      repository,
      ACTOR,
      {
        ...base,
        interpretV2: async () =>
          semanticOutcomeSchema.parse({
            type: "clarification",
            intentFamily: "create_consultant",
            knownFacts: { name: "Anna" },
            missing: ["surname", "level", "role"],
            question: "What surname, level, and role should Anna have?",
            reason: "The remaining profile fields are required.",
          }),
      },
    );
    expect(clarification).toMatchObject({
      ok: true,
      kind: "semantic_clarification",
      pendingClarification: { intentFamily: "create_consultant" },
    });

    const write = await handleCapacityAssistant(
      { mode: "interpret", message: "not a read" },
      repository,
      ACTOR,
      {
        ...base,
        interpretV2: async () =>
          semanticOutcomeSchema.parse({
            type: "write",
            action: { kind: "createDemand", demand: { title: "Nope" } },
          }),
      },
    );
    expect(write).toMatchObject({
      ok: false,
      error: { code: "V2_WRITE_CUTOVER_NOT_READY" },
    });

    const relativeWrite = await handleCapacityAssistant(
      { mode: "interpret", message: "not a read" },
      repository,
      ACTOR,
      {
        ...base,
        interpretV2: async () =>
          semanticOutcomeSchema.parse({
            type: "relativeWrite",
            asOf: { kind: "date", date: "2026-09-15" },
            operation: {
              kind: "adjustConsultantCapacity",
              consultant: { kind: "name", name: "Alex Smith" },
              delta: 10,
            },
          }),
      },
    );
    expect(relativeWrite).toMatchObject({
      ok: false,
      error: { code: "V2_WRITE_CUTOVER_NOT_READY" },
    });

    const multiple = await handleCapacityAssistant(
      { mode: "interpret", message: "not a read" },
      repository,
      ACTOR,
      {
        ...base,
        interpretV2: async () =>
          semanticOutcomeSchema.parse({
            type: "multiple_changes",
            changeCount: 2,
            reason: "Two changes.",
          }),
      },
    );
    expect(multiple).toMatchObject({
      ok: true,
      kind: "multiple_changes",
      changeCount: 2,
    });

    const help = await handleCapacityAssistant(
      { mode: "interpret", message: "not a read" },
      repository,
      ACTOR,
      {
        ...base,
        interpretV2: async () =>
          semanticOutcomeSchema.parse({ type: "conversation_or_help", topic: "howToUse" }),
      },
    );
    expect(help).toMatchObject({ ok: true, kind: "conversation_or_help", topic: "howToUse" });

    const compileFailure = await handleCapacityAssistant(
      { mode: "interpret", message: "broken read" },
      repository,
      ACTOR,
      {
        ...base,
        interpretV2: async () =>
          semanticOutcomeSchema.parse({
            type: "read",
            action: { kind: "getTeamOverview", onDate: { kind: "date", date: "2026-09-15" } },
          }),
        compileV2: () => {
          throw new Error("compiler secret");
        },
      },
    );
    expect(compileFailure).toMatchObject({
      ok: false,
      error: { code: "V2_READ_CUTOVER_COMPILE_FAILED" },
    });
    expect(legacyCalls).toBe(0);
    expect(repository.applyCount).toBe(0);
  });
});
