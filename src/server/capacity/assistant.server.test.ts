// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { beforeEach, describe, expect, test } from "bun:test";

import type { ActionPreview, CapacityDataSet, ResolvedAction } from "@/domain/capacity/contracts";
import type { CapacityIntent } from "@/domain/capacity/assistant";
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

  async load() {
    return structuredClone(this.data);
  }

  async apply(action: ResolvedAction, preview: ActionPreview): Promise<RepositoryMutation> {
    this.applyCount++;
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

describe("Capacity assistant orchestration", () => {
  let repository: MemoryRepository;

  beforeEach(() => {
    repository = new MemoryRepository();
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
      { mode: "interpret", message: "Assign Alex" },
      repository,
      ACTOR,
      { currentDate: "2026-09-15", interpret: interpreter(intent) },
    );
    expect(first).toMatchObject({ ok: true, kind: "clarification", field: "consultant" });
    if (!first.ok || first.kind !== "clarification") throw new Error("Expected clarification");

    const chosen = await handleCapacityAssistant(
      {
        mode: "clarify",
        intent: first.intent,
        selections: [{ field: first.field, candidateId: ALEX_ONE }],
      },
      repository,
      ACTOR,
      { currentDate: "2026-09-15" },
    );
    expect(chosen).toMatchObject({ ok: true, kind: "preview" });
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

  test("unsupported intent cannot reach the repository mutation path", async () => {
    const response = await handleCapacityAssistant(
      { mode: "interpret", message: "Delete everyone" },
      repository,
      ACTOR,
      {
        currentDate: "2026-09-15",
        interpret: interpreter({ type: "unsupported", reason: "destructive_action" }),
      },
    );
    expect(response).toMatchObject({ ok: true, kind: "unsupported" });
    expect(repository.applyCount).toBe(0);
  });
});
