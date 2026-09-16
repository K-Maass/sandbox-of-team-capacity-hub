// @ts-expect-error -- Bun provides this module at test runtime; app builds do not include Bun types.
import { describe, expect, test } from "bun:test";

import type { CapacityDataSet } from "./contracts";
import {
  DEFAULT_RANGE_BOUNDS,
  enumerateCalendarDates,
  findAvailabilityWindows,
  getCapacityRange,
  getTeamOverviewRange,
  workingDates,
} from "./ranges";

const CONSULTANT = "00000000-0000-4000-8000-000000000001";
const DEMAND = "10000000-0000-4000-8000-000000000001";
const VERSION = "2026-09-15T10:00:00.000Z";

function data(): CapacityDataSet {
  return {
    consultants: [
      {
        id: CONSULTANT,
        name: "Karim",
        surname: "Maass",
        email: null,
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
    ],
    demands: [
      {
        id: DEMAND,
        title: "Phoenix",
        client: "Client",
        type: "Project",
        status: "Won",
        description: "",
        skills: ["AI"],
        startDate: "2026-09-14",
        endDate: "2026-09-18",
        requiredCapacity: 100,
        owner: null,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ],
    allocations: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        demandId: DEMAND,
        consultantId: CONSULTANT,
        capacity: 40,
        createdAt: VERSION,
        updatedAt: VERSION,
      },
    ],
    availabilityBlocks: [],
  };
}

describe("bounded range capacity semantics", () => {
  test("keeps calendar dates intact while capacity evaluates working days", () => {
    const range = { startDate: "2026-09-19", endDate: "2026-09-21" };
    expect(enumerateCalendarDates(range, DEFAULT_RANGE_BOUNDS.maxDateHorizonDays)).toEqual([
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ]);
    expect(workingDates(range, DEFAULT_RANGE_BOUNDS.maxDateHorizonDays)).toEqual(["2026-09-21"]);
  });

  test("returns daily variation and minimum capacity rather than averaging it away", () => {
    const value = data();
    value.availabilityBlocks.push({
      id: "30000000-0000-4000-8000-000000000001",
      consultantId: CONSULTANT,
      startDate: "2026-09-15",
      endDate: "2026-09-16",
      note: "Training",
      createdAt: VERSION,
      updatedAt: VERSION,
    });
    const result = getCapacityRange(
      value,
      value.consultants[0],
      { startDate: "2026-09-14", endDate: "2026-09-18" },
      false,
    );
    expect(result.days.map((day) => day.effectiveWorkingCapacity)).toEqual([100, 0, 0, 100, 100]);
    expect(result.aggregate.minimumFreeCapacity).toBe(-40);
    expect(result.aggregate.maximumFreeCapacity).toBe(60);
  });

  test("enforces the date and working-day bounds", () => {
    expect(() =>
      enumerateCalendarDates(
        { startDate: "2026-01-01", endDate: "2027-01-02" },
        DEFAULT_RANGE_BOUNDS.maxDateHorizonDays,
      ),
    ).toThrow("DATE_HORIZON_EXCEEDED");
    expect(DEFAULT_RANGE_BOUNDS.maxWorkingDays).toBe(262);
    expect(DEFAULT_RANGE_BOUNDS.maxResultCount).toBe(100);
    expect(DEFAULT_RANGE_BOUNDS.maxScenarioPeople).toBe(25);
    expect(DEFAULT_RANGE_BOUNDS.maxScenarioDemands).toBe(100);
  });

  test("does not treat zero-capacity or unavailable people as threshold-qualified", () => {
    const value = data();
    value.consultants[0].workingCapacity = 0;
    expect(
      findAvailabilityWindows(
        value,
        value.consultants,
        { startDate: "2026-09-14", endDate: "2026-09-18" },
        0,
        5,
        false,
        DEFAULT_RANGE_BOUNDS,
      ),
    ).toHaveLength(0);
    value.consultants[0].workingCapacity = 100;
    value.availabilityBlocks.push({
      id: "30000000-0000-4000-8000-000000000001",
      consultantId: CONSULTANT,
      startDate: "2026-09-15",
      endDate: "2026-09-16",
      note: "Away",
      createdAt: VERSION,
      updatedAt: VERSION,
    });
    expect(
      findAvailabilityWindows(
        value,
        value.consultants,
        { startDate: "2026-09-14", endDate: "2026-09-18" },
        0,
        5,
        false,
        DEFAULT_RANGE_BOUNDS,
      ),
    ).toHaveLength(0);
  });

  test("includes open-ended demands in team-range staffing overlap", () => {
    const value = data();
    value.demands[0].startDate = null;
    value.demands[0].endDate = null;
    const overview = getTeamOverviewRange(
      value,
      { startDate: "2026-09-14", endDate: "2026-09-18" },
      false,
      DEFAULT_RANGE_BOUNDS,
    );
    expect(overview.days.every((day) => day.unstaffedDemandGap === 60)).toBe(true);
  });
});
