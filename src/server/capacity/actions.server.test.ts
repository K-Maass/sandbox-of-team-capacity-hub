// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { beforeEach, describe, expect, test } from "bun:test";

import type { ActionPreview, CapacityDataSet, ResolvedAction } from "@/domain/capacity/contracts";
import { capacityActionRequestSchema } from "@/domain/capacity/validation";
import { executeCapacityAction } from "./actions.server";
import type { CapacityRepository, RepositoryMutation } from "./repository";

const ALEX = "00000000-0000-4000-8000-000000000001";
const BLAIR = "00000000-0000-4000-8000-000000000002";
const ALPHA = "10000000-0000-4000-8000-000000000001";
const BETA = "10000000-0000-4000-8000-000000000002";
const PIPELINE = "10000000-0000-4000-8000-000000000003";
const ALLOCATION = "20000000-0000-4000-8000-000000000001";
const OTHER_ALLOCATION = "20000000-0000-4000-8000-000000000002";
const ACTOR = "30000000-0000-4000-8000-000000000001";
const VERSION = "2026-09-15T10:00:00.000Z";

function fixture(): CapacityDataSet {
  return {
    consultants: [
      {
        id: ALEX,
        name: "Alex",
        surname: "Smith",
        email: "alex@example.com",
        level: "Consultant",
        role: "Strategy",
        skills: ["AI", "Supply Chain"],
        workingCapacity: 100,
        archivedAt: null,
        linkedToUser: true,
        isCurrentUser: true,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
      {
        id: BLAIR,
        name: "Blair",
        surname: "Archived",
        email: null,
        level: "Senior",
        role: "Data",
        skills: ["AI"],
        workingCapacity: 60,
        archivedAt: VERSION,
        linkedToUser: false,
        isCurrentUser: false,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ],
    demands: [
      {
        id: ALPHA,
        title: "Alpha",
        client: "Client A",
        type: "Project",
        status: "Won",
        description: "",
        skills: ["AI", "Pricing"],
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        requiredCapacity: 100,
        owner: null,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
      {
        id: BETA,
        title: "Beta",
        client: "Client B",
        type: "Project",
        status: "Won",
        description: "",
        skills: ["Supply Chain"],
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        requiredCapacity: 100,
        owner: null,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
      {
        id: PIPELINE,
        title: "Pipeline",
        client: "Client C",
        type: "RfP",
        status: "Incoming",
        description: "",
        skills: ["AI"],
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        requiredCapacity: 200,
        owner: null,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ],
    allocations: [
      {
        id: ALLOCATION,
        consultantId: ALEX,
        demandId: ALPHA,
        capacity: 60,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ],
    availabilityBlocks: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryRepository implements CapacityRepository {
  data = fixture();
  applyCount = 0;
  #counter = 1;

  async load() {
    return clone(this.data);
  }

  #nextId(prefix: string) {
    return `${prefix}0000000-0000-4000-8000-${String(this.#counter++).padStart(12, "0")}`;
  }

  #timestamp() {
    return `2026-09-15T10:00:${String(this.#counter++).padStart(2, "0")}.000Z`;
  }

  async apply(
    action: ResolvedAction,
    preview: ActionPreview,
    actorUserId: string,
  ): Promise<RepositoryMutation> {
    this.applyCount++;
    const changedFields = preview.changes.map((item) => item.field);
    switch (action.kind) {
      case "updateConsultant": {
        const item = this.data.consultants.find((row) => row.id === action.consultantId)!;
        Object.assign(item, action.patch);
        if (action.patch.archived !== undefined) {
          item.archivedAt = action.patch.archived ? this.#timestamp() : null;
          delete item.archived;
        }
        item.updatedAt = this.#timestamp();
        return { entityId: item.id, changedFields };
      }
      case "createDemand": {
        const owner = action.demand.ownerConsultantId
          ? this.data.consultants.find((item) => item.id === action.demand.ownerConsultantId)
          : null;
        const item = {
          id: this.#nextId("4"),
          title: action.demand.title,
          client: action.demand.client,
          type: action.demand.type,
          status: action.demand.status,
          description: action.demand.description,
          skills: action.demand.skills,
          startDate: action.demand.startDate,
          endDate: action.demand.endDate,
          requiredCapacity: action.demand.requiredCapacity,
          owner: owner
            ? {
                id: owner.id,
                name: owner.name,
                surname: owner.surname,
                archivedAt: owner.archivedAt,
              }
            : null,
          createdAt: this.#timestamp(),
          updatedAt: this.#timestamp(),
          createdBy: actorUserId,
        };
        this.data.demands.push(item);
        return { entityId: item.id, changedFields };
      }
      case "updateDemand": {
        const item = this.data.demands.find((row) => row.id === action.demandId)!;
        for (const [key, value] of Object.entries(action.patch)) {
          if (key !== "ownerConsultantId") item[key] = value;
        }
        if (action.patch.ownerConsultantId !== undefined) {
          const owner = action.patch.ownerConsultantId
            ? this.data.consultants.find((row) => row.id === action.patch.ownerConsultantId)
            : null;
          item.owner = owner
            ? {
                id: owner.id,
                name: owner.name,
                surname: owner.surname,
                archivedAt: owner.archivedAt,
              }
            : null;
        }
        item.updatedAt = this.#timestamp();
        return { entityId: item.id, changedFields };
      }
      case "setAllocation": {
        const existing = this.data.allocations.find((item) => item.id === action.allocationId);
        if (existing) {
          existing.capacity = action.capacity;
          existing.updatedAt = this.#timestamp();
          return { entityId: existing.id, changedFields };
        }
        const item = {
          id: this.#nextId("5"),
          consultantId: action.consultantId,
          demandId: action.demandId,
          capacity: action.capacity,
          createdAt: this.#timestamp(),
          updatedAt: this.#timestamp(),
        };
        this.data.allocations.push(item);
        return { entityId: item.id, changedFields };
      }
      case "removeAllocation": {
        const index = this.data.allocations.findIndex((item) => item.id === action.allocationId);
        const [item] = this.data.allocations.splice(index, 1);
        return { entityId: item.id, changedFields };
      }
      case "addAvailabilityBlock": {
        const item = {
          id: this.#nextId("6"),
          consultantId: action.consultantId,
          startDate: action.startDate,
          endDate: action.endDate,
          note: action.note,
          createdAt: this.#timestamp(),
          updatedAt: this.#timestamp(),
        };
        this.data.availabilityBlocks.push(item);
        return { entityId: item.id, changedFields };
      }
      case "removeAvailabilityBlock": {
        const index = this.data.availabilityBlocks.findIndex(
          (item) => item.id === action.availabilityBlockId,
        );
        const [item] = this.data.availabilityBlocks.splice(index, 1);
        return { entityId: item.id, changedFields };
      }
    }
  }
}

function parse(value: unknown) {
  return capacityActionRequestSchema.parse(value);
}

function previewFrom(response: Awaited<ReturnType<typeof executeCapacityAction>>) {
  expect(response.ok).toBe(true);
  return response.data as ActionPreview;
}

describe("typed Capacity Hub action service", () => {
  let repository: MemoryRepository;

  beforeEach(() => {
    repository = new MemoryRepository();
  });

  test("reads deterministic capacity, staffing progress and skill-ranked candidates", async () => {
    const capacity = await executeCapacityAction(
      parse({
        mode: "read",
        action: { kind: "getCapacity", consultant: { name: "Alex Smith" }, onDate: "2026-09-15" },
      }),
      repository,
      ACTOR,
    );
    expect(capacity.data.capacity).toMatchObject({ committedCapacity: 60, rawFreeCapacity: 40 });

    const demand = await executeCapacityAction(
      parse({ mode: "read", action: { kind: "getDemand", demand: { title: "Pipeline" } } }),
      repository,
      ACTOR,
    );
    expect(demand.data.staffing).toMatchObject({
      requiredCapacity: 200,
      staffedCapacity: 0,
      gapCapacity: 200,
    });

    const candidates = await executeCapacityAction(
      parse({
        mode: "read",
        action: {
          kind: "findStaffingCandidates",
          demand: { title: "Alpha" },
          onDate: "2026-09-15",
        },
      }),
      repository,
      ACTOR,
    );
    expect(candidates.data.candidates.map((item) => item.consultant.id)).toEqual([ALEX]);
    expect(candidates.data.candidates[0].skillMatch).toMatchObject({ count: 1, matched: ["AI"] });
  });

  test("excludes only the target demand allocation from suitable-demand capacity baseline", async () => {
    repository.data.demands[0].requiredCapacity = 70;
    repository.data.demands[0].skills = ["AI"];
    repository.data.allocations = [
      {
        id: ALLOCATION,
        consultantId: ALEX,
        demandId: ALPHA,
        capacity: 30,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
      {
        id: OTHER_ALLOCATION,
        consultantId: ALEX,
        demandId: BETA,
        capacity: 50,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ];
    const result = await executeCapacityAction(
      parse({
        mode: "read",
        action: {
          kind: "findSuitableDemands",
          consultant: { name: "Alex Smith" },
          startDate: "2026-09-14",
          endDate: "2026-09-18",
          includePipeline: false,
        },
      }),
      repository,
      ACTOR,
    );
    expect(result.data.demands).toContainEqual(
      expect.objectContaining({
        demand: expect.objectContaining({ id: ALPHA }),
        staffing: expect.objectContaining({ gapCapacity: 40 }),
      }),
    );
  });

  test("canonicalizes internal whitespace in skill-supply filters", async () => {
    const result = await executeCapacityAction(
      parse({
        mode: "read",
        action: {
          kind: "skillSupplyDemand",
          startDate: "2026-09-14",
          endDate: "2026-09-18",
          includePipeline: false,
          skill: "  SUPPLY   CHAIN ",
        },
      }),
      repository,
      ACTOR,
    );
    expect(result.data.skills).toEqual([
      expect.objectContaining({ skill: "Supply Chain", consultants: 1, demandCount: 1 }),
    ]);
  });

  test("supports every primitive and derived read contract", async () => {
    const listConsultants = await executeCapacityAction(
      parse({ mode: "read", action: { kind: "listConsultants", onDate: "2026-09-15" } }),
      repository,
      ACTOR,
    );
    expect(listConsultants.data).toMatchObject({ count: 1 });
    expect(listConsultants.data.consultants[0].consultant.id).toBe(ALEX);

    const getConsultant = await executeCapacityAction(
      parse({
        mode: "read",
        action: {
          kind: "getConsultant",
          consultant: { email: "alex@example.com" },
          onDate: "2026-09-15",
        },
      }),
      repository,
      ACTOR,
    );
    expect(getConsultant.data).toMatchObject({
      consultant: { id: ALEX },
      capacity: { committedCapacity: 60 },
    });
    expect(getConsultant.data.allocations).toHaveLength(1);

    const listDemands = await executeCapacityAction(
      parse({
        mode: "read",
        action: { kind: "listDemands", statuses: ["Won"], activeOn: "2026-09-15" },
      }),
      repository,
      ACTOR,
    );
    expect(listDemands.data.count).toBe(2);

    const overview = await executeCapacityAction(
      parse({ mode: "read", action: { kind: "getTeamOverview", onDate: "2026-09-15" } }),
      repository,
      ACTOR,
    );
    expect(overview.data.team).toMatchObject({
      activeCount: 1,
      archivedCount: 1,
      effectiveWorkingCapacity: 100,
      committedCapacity: 60,
      rawFreeCapacity: 40,
    });
    expect(overview.data.demand).toMatchObject({
      requiredCapacity: 200,
      staffedCapacity: 60,
      gapCapacity: 140,
    });
  });

  test("previews over-allocation as a warning and still permits confirmed execution", async () => {
    const action = {
      kind: "setAllocation",
      consultant: { name: "Alex Smith" },
      demand: { title: "Beta" },
      capacity: 50,
    };
    const preview = previewFrom(
      await executeCapacityAction(
        parse({ mode: "preview", action, asOfDate: "2026-09-15" }),
        repository,
        ACTOR,
      ),
    );
    expect(preview.warnings.map((item) => item.code)).toContain("OVER_ALLOCATION");
    expect(preview.impact.capacity[0].after.rawFreeCapacity).toBe(-10);

    const result = await executeCapacityAction(
      parse({
        mode: "confirm",
        confirmed: true,
        action,
        asOfDate: "2026-09-15",
        previewId: preview.previewId,
      }),
      repository,
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ phase: "executed", changed: true });
    expect(repository.data.allocations).toContainEqual(
      expect.objectContaining({ consultantId: ALEX, demandId: BETA, capacity: 50 }),
    );
  });

  test("confirmation regenerates from the original action and rejects tampering", async () => {
    const action = {
      kind: "setAllocation",
      consultant: { name: "Alex Smith" },
      demand: { title: "Beta" },
      capacity: 50,
    };
    const preview = previewFrom(
      await executeCapacityAction(
        parse({ mode: "preview", action, asOfDate: "2026-09-15" }),
        repository,
        ACTOR,
      ),
    );
    const result = await executeCapacityAction(
      parse({
        mode: "confirm",
        confirmed: true,
        action: { ...action, capacity: 55 },
        asOfDate: "2026-09-15",
        previewId: preview.previewId,
      }),
      repository,
      ACTOR,
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("STALE_PREVIEW");
    expect(result.replacementPreview.action.capacity).toBe(55);
    expect(repository.applyCount).toBe(0);
  });

  test("database changes between preview and confirmation return a replacement preview", async () => {
    const action = {
      kind: "updateConsultant",
      consultant: { name: "Alex Smith" },
      patch: { workingCapacity: 80 },
    };
    const preview = previewFrom(
      await executeCapacityAction(
        parse({ mode: "preview", action, asOfDate: "2026-09-15" }),
        repository,
        ACTOR,
      ),
    );
    repository.data.demands[0].updatedAt = "2026-09-15T11:00:00.000Z";
    const result = await executeCapacityAction(
      parse({
        mode: "confirm",
        confirmed: true,
        action,
        asOfDate: "2026-09-15",
        previewId: preview.previewId,
      }),
      repository,
      ACTOR,
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("STALE_PREVIEW");
    expect(result.replacementPreview.previewId).not.toBe(preview.previewId);
    expect(repository.applyCount).toBe(0);
  });

  test("returns stale rather than executing when the target no longer exists", async () => {
    const action = {
      kind: "removeAllocation",
      consultant: { name: "Alex Smith" },
      demand: { title: "Alpha" },
    };
    const preview = previewFrom(
      await executeCapacityAction(
        parse({ mode: "preview", action, asOfDate: "2026-09-15" }),
        repository,
        ACTOR,
      ),
    );
    repository.data.allocations = [];
    const result = await executeCapacityAction(
      parse({
        mode: "confirm",
        confirmed: true,
        action,
        asOfDate: "2026-09-15",
        previewId: preview.previewId,
      }),
      repository,
      ACTOR,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "STALE_PREVIEW" },
      replacementPreview: null,
      currentError: { code: "NOT_FOUND" },
    });
    expect(repository.applyCount).toBe(0);
  });

  test("supports consultant and demand updates plus demand creation", async () => {
    for (const action of [
      { kind: "updateConsultant", consultant: { name: "Alex Smith" }, patch: { role: "Data" } },
      { kind: "updateDemand", demand: { title: "Alpha" }, patch: { requiredCapacity: 150 } },
      { kind: "createDemand", demand: { title: "Gamma", requiredCapacity: 75 } },
    ]) {
      const preview = previewFrom(
        await executeCapacityAction(
          parse({ mode: "preview", action, asOfDate: "2026-09-15" }),
          repository,
          ACTOR,
        ),
      );
      const result = await executeCapacityAction(
        parse({
          mode: "confirm",
          confirmed: true,
          action,
          asOfDate: "2026-09-15",
          previewId: preview.previewId,
        }),
        repository,
        ACTOR,
      );
      expect(result.ok).toBe(true);
      expect(result.data.changed).toBe(true);
    }
    expect(repository.data.consultants[0].role).toBe("Data");
    expect(repository.data.demands.find((item) => item.id === ALPHA).requiredCapacity).toBe(150);
    expect(repository.data.demands.some((item) => item.title === "Gamma")).toBe(true);
  });

  test("adds and removes availability blocks with impact warnings", async () => {
    const addAction = {
      kind: "addAvailabilityBlock",
      consultant: { name: "Alex Smith" },
      startDate: "2026-09-10",
      endDate: "2026-09-20",
      note: "Training",
    };
    const addPreview = previewFrom(
      await executeCapacityAction(
        parse({ mode: "preview", action: addAction, asOfDate: "2026-09-15" }),
        repository,
        ACTOR,
      ),
    );
    expect(addPreview.warnings.map((item) => item.code)).toContain("AFFECTED_ACTIVE_WORK");
    expect(addPreview.impact.capacity[0].after).toMatchObject({
      effectiveWorkingCapacity: 0,
      isUnavailable: true,
      availabilityBlockId: null,
    });
    await executeCapacityAction(
      parse({
        mode: "confirm",
        confirmed: true,
        action: addAction,
        asOfDate: "2026-09-15",
        previewId: addPreview.previewId,
      }),
      repository,
      ACTOR,
    );
    const block = repository.data.availabilityBlocks[0];
    expect(block).toBeDefined();

    const removeAction = {
      kind: "removeAvailabilityBlock",
      block: { availabilityBlockId: block.id },
    };
    const removePreview = previewFrom(
      await executeCapacityAction(
        parse({ mode: "preview", action: removeAction, asOfDate: "2026-09-15" }),
        repository,
        ACTOR,
      ),
    );
    const removed = await executeCapacityAction(
      parse({
        mode: "confirm",
        confirmed: true,
        action: removeAction,
        asOfDate: "2026-09-15",
        previewId: removePreview.previewId,
      }),
      repository,
      ACTOR,
    );
    expect(removed.ok).toBe(true);
    expect(repository.data.availabilityBlocks).toHaveLength(0);
  });

  test("rejects overlapping availability and allocation to archived consultants", async () => {
    repository.data.availabilityBlocks.push({
      id: "60000000-0000-4000-8000-000000000001",
      consultantId: ALEX,
      startDate: "2026-09-10",
      endDate: "2026-09-20",
      note: "Away",
      createdAt: VERSION,
      updatedAt: VERSION,
    });
    const overlap = await executeCapacityAction(
      parse({
        mode: "preview",
        asOfDate: "2026-09-15",
        action: {
          kind: "addAvailabilityBlock",
          consultant: { name: "Alex Smith" },
          startDate: "2026-09-20",
          endDate: "2026-09-22",
        },
      }),
      repository,
      ACTOR,
    );
    expect(overlap).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    const archived = await executeCapacityAction(
      parse({
        mode: "preview",
        asOfDate: "2026-09-15",
        action: {
          kind: "setAllocation",
          consultant: { name: "Blair Archived" },
          demand: { title: "Beta" },
          capacity: 25,
        },
      }),
      repository,
      ACTOR,
    );
    expect(archived).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  test("removes an allocation only after matching confirmation", async () => {
    const action = {
      kind: "removeAllocation",
      consultant: { name: "Alex Smith" },
      demand: { title: "Alpha" },
    };
    const preview = previewFrom(
      await executeCapacityAction(
        parse({ mode: "preview", action, asOfDate: "2026-09-15" }),
        repository,
        ACTOR,
      ),
    );
    const result = await executeCapacityAction(
      parse({
        mode: "confirm",
        confirmed: true,
        action,
        asOfDate: "2026-09-15",
        previewId: preview.previewId,
      }),
      repository,
      ACTOR,
    );
    expect(result.ok).toBe(true);
    expect(repository.data.allocations).toHaveLength(0);
    expect(result.data.actualImpact.staffing[0].after.gapCapacity).toBe(100);
  });

  test("reports an exact no-op without issuing a mutation", async () => {
    const action = {
      kind: "setAllocation",
      consultant: { name: "Alex Smith" },
      demand: { title: "Alpha" },
      capacity: 60,
    };
    const preview = previewFrom(
      await executeCapacityAction(
        parse({ mode: "preview", action, asOfDate: "2026-09-15" }),
        repository,
        ACTOR,
      ),
    );
    expect(preview.changes).toHaveLength(0);
    const result = await executeCapacityAction(
      parse({
        mode: "confirm",
        confirmed: true,
        action,
        asOfDate: "2026-09-15",
        previewId: preview.previewId,
      }),
      repository,
      ACTOR,
    );
    expect(result.data).toMatchObject({
      changed: false,
      before: { capacity: 60 },
      after: { capacity: 60 },
    });
    expect(repository.applyCount).toBe(0);
  });

  test("prevents duplicate consultant email creation before mutation", async () => {
    const duplicate = await executeCapacityAction(
      parse({
        mode: "preview",
        asOfDate: "2026-09-15",
        action: {
          kind: "createConsultant",
          consultant: { name: "Another", surname: "Alex", email: "ALEX@example.com" },
        },
      }),
      repository,
      ACTOR,
    );
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", field: "consultant.email" },
    });
  });
});
