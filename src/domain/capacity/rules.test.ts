// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import {
  demandConsumesCapacityOn,
  demandIsPipelineOn,
  demandOverlapsDate,
  demandOverlapsRange,
  freeCapacityOn,
  pipelineCapacity,
  skillMatchCount,
  staffedCapacity,
  usedCapacity,
  workingCapacityOn,
  type Allocation,
  type AvailabilityBlock,
  type Consultant,
  type Demand,
} from "@/lib/types";

const consultant: Consultant = {
  id: "consultant-1",
  userId: null,
  name: "Alex",
  surname: "Example",
  email: null,
  level: "Consultant",
  role: "Strategy",
  skills: ["AI", "Supply Chain"],
  workingCapacity: 100,
  archivedAt: null,
};

const committedDemand: Demand = {
  id: "demand-1",
  title: "Committed",
  client: "Client",
  type: "Project",
  status: "Won",
  description: "",
  skills: ["ai"],
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  requiredCapacity: 100,
  ownerConsultantId: null,
};

const pipelineDemand: Demand = {
  ...committedDemand,
  id: "demand-2",
  title: "Pipeline",
  status: "Incoming",
};

const allocations: Allocation[] = [
  { id: "allocation-1", consultantId: consultant.id, demandId: committedDemand.id, capacity: 60 },
  { id: "allocation-2", consultantId: consultant.id, demandId: pipelineDemand.id, capacity: 50 },
];

describe("current Capacity Hub business-rule characterization", () => {
  test("demand date ranges are inclusive and null boundaries are open", () => {
    expect(demandOverlapsDate(committedDemand, "2026-09-01")).toBe(true);
    expect(demandOverlapsDate(committedDemand, "2026-09-30")).toBe(true);
    expect(demandOverlapsDate(committedDemand, "2026-10-01")).toBe(false);
    expect(demandOverlapsRange(committedDemand, "2026-08-31", "2026-09-01")).toBe(true);
    expect(
      demandOverlapsDate({ ...committedDemand, startDate: null, endDate: null }, "2030-01-01"),
    ).toBe(true);
  });

  test("Won and In Progress consume committed capacity while Incoming stays pipeline", () => {
    expect(demandConsumesCapacityOn(committedDemand, "2026-09-15")).toBe(true);
    expect(
      demandConsumesCapacityOn({ ...committedDemand, status: "In Progress" }, "2026-09-15"),
    ).toBe(true);
    expect(demandConsumesCapacityOn(pipelineDemand, "2026-09-15")).toBe(false);
    expect(demandIsPipelineOn(pipelineDemand, "2026-09-15")).toBe(true);
    expect(demandConsumesCapacityOn({ ...committedDemand, status: "Lost" }, "2026-09-15")).toBe(
      false,
    );
  });

  test("simultaneous allocations sum by demand status and date", () => {
    const demands = [committedDemand, pipelineDemand];
    expect(usedCapacity(consultant.id, demands, allocations, "2026-09-15")).toBe(60);
    expect(pipelineCapacity(consultant.id, demands, allocations, "2026-09-15")).toBe(50);
    expect(usedCapacity(consultant.id, demands, allocations, "2026-10-15")).toBe(0);
    expect(
      usedCapacity(consultant.id, demands, allocations, "2026-09-15", committedDemand.id),
    ).toBe(0);
  });

  test("non-overlapping committed demands do not consume capacity simultaneously", () => {
    const laterDemand = {
      ...committedDemand,
      id: "demand-later",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    };
    const laterAllocation = {
      id: "allocation-later",
      consultantId: consultant.id,
      demandId: laterDemand.id,
      capacity: 50,
    };
    expect(
      usedCapacity(
        consultant.id,
        [committedDemand, laterDemand],
        [allocations[0], laterAllocation],
        "2026-09-15",
      ),
    ).toBe(60);
    expect(
      usedCapacity(
        consultant.id,
        [committedDemand, laterDemand],
        [allocations[0], laterAllocation],
        "2026-10-15",
      ),
    ).toBe(50);
  });

  test("availability blocks and archiving reduce effective working capacity to zero", () => {
    const blocks: AvailabilityBlock[] = [
      {
        id: "block-1",
        consultantId: consultant.id,
        startDate: "2026-09-10",
        endDate: "2026-09-20",
        note: "Away",
      },
    ];
    expect(workingCapacityOn(consultant, blocks, "2026-09-15")).toBe(0);
    expect(workingCapacityOn(consultant, blocks, "2026-09-21")).toBe(100);
    expect(
      workingCapacityOn({ ...consultant, archivedAt: "2026-09-01T00:00:00Z" }, [], "2026-09-15"),
    ).toBe(0);
  });

  test("free capacity can be negative and pipeline is opt-in", () => {
    const demands = [committedDemand, pipelineDemand];
    expect(freeCapacityOn(consultant, demands, allocations, [], "2026-09-15", false)).toBe(40);
    expect(freeCapacityOn(consultant, demands, allocations, [], "2026-09-15", true)).toBe(-10);
    expect(
      freeCapacityOn(
        { ...consultant, workingCapacity: 60 },
        demands,
        allocations,
        [],
        "2026-09-15",
        false,
      ),
    ).toBe(0);
  });

  test("staffing ignores archived consultants but preserves their allocations", () => {
    expect(staffedCapacity(committedDemand.id, allocations, [consultant])).toBe(60);
    expect(
      staffedCapacity(committedDemand.id, allocations, [
        { ...consultant, archivedAt: "2026-09-01T00:00:00Z" },
      ]),
    ).toBe(0);
  });

  test("skill matching is exact and case-insensitive without hidden fuzzy matching", () => {
    expect(skillMatchCount(consultant.skills, ["ai", "Supply Chain"])).toBe(2);
    expect(skillMatchCount(consultant.skills, ["Generative AI"])).toBe(0);
    expect(skillMatchCount(consultant.skills, [" Supply Chain "])).toBe(0);
  });
});
