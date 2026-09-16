import type {
  CapacityDataSet,
  CapacitySnapshot,
  ConsultantDto,
  DemandDto,
  StaffingSnapshot,
} from "./contracts";
import { getCapacitySnapshot, getSkillMatch, getStaffingSnapshot } from "./metrics";
import { demandOverlapsRange } from "./rules";

export type DateRange = {
  startDate: string;
  endDate: string;
  label?: string;
};

export type RangeBounds = {
  maxDateHorizonDays: number;
  maxWorkingDays: number;
  maxResultCount: number;
  defaultResultCount: number;
  maxScenarioPeople?: number;
  maxScenarioDemands?: number;
};

export const DEFAULT_RANGE_BOUNDS: RangeBounds = {
  maxDateHorizonDays: 366,
  maxWorkingDays: 262,
  maxResultCount: 100,
  defaultResultCount: 20,
  maxScenarioPeople: 25,
  maxScenarioDemands: 100,
};

export type CapacityRangeAggregate = {
  workingDaysConsidered: number;
  normalWorkingCapacity: number;
  effectiveWorkingCapacity: number;
  committedCapacity: number;
  pipelineCapacity: number;
  averageFreeCapacity: number;
  minimumFreeCapacity: number;
  maximumFreeCapacity: number;
  averageCommittedCapacity: number;
  averagePipelineCapacity: number;
  unavailableDays: number;
  overAllocatedDays: number;
  isAlwaysAvailable: boolean;
  isAlwaysFree: boolean;
};

export type CapacityRangeResult = {
  consultant: ConsultantDto;
  range: DateRange;
  workingDays: string[];
  days: CapacitySnapshot[];
  aggregate: CapacityRangeAggregate;
};

export type TeamRangeResult = {
  range: DateRange;
  workingDays: string[];
  days: Array<{
    onDate: string;
    effectiveWorkingCapacity: number;
    committedCapacity: number;
    pipelineCapacity: number;
    availableCapacity: number;
    overAllocatedCapacity: number;
    activeCount: number;
    unstaffedDemandGap: number;
  }>;
  aggregate: {
    averageEffectiveWorkingCapacity: number;
    averageCommittedCapacity: number;
    averagePipelineCapacity: number;
    averageFreeCapacity: number;
    minimumFreeCapacity: number;
    maximumFreeCapacity: number;
    overAllocatedPeople: Array<{ consultant: ConsultantDto; days: number }>;
    unavailablePeople: Array<{ consultant: ConsultantDto; days: number }>;
  };
};

export type AvailabilityWindow = {
  consultant: ConsultantDto;
  range: DateRange;
  workingDays: number;
  minimumFreeCapacity: number;
  averageFreeCapacity: number;
};

export type RangeStaffingCandidate = {
  consultant: ConsultantDto;
  range: CapacityRangeResult;
  skillMatch: ReturnType<typeof getSkillMatch>;
  canCoverMinimum: boolean;
};

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function enumerateCalendarDates(range: DateRange, maxDays: number): string[] {
  const start = parseDate(range.startDate);
  const end = parseDate(range.endDate);
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (days.length >= maxDays) throw new Error("DATE_HORIZON_EXCEEDED");
    days.push(formatDate(cursor));
  }
  return days;
}

export function workingDates(range: DateRange, maxDays: number): string[] {
  return enumerateCalendarDates(range, maxDays).filter((date) => {
    const weekday = parseDate(date).getUTCDay();
    return weekday >= 1 && weekday <= 5;
  });
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function getCapacityRange(
  data: CapacityDataSet,
  consultant: ConsultantDto,
  range: DateRange,
  includePipeline: boolean,
  bounds: RangeBounds = DEFAULT_RANGE_BOUNDS,
  excludedDemandId: string | null = null,
): CapacityRangeResult {
  const calendarDays = enumerateCalendarDates(range, bounds.maxDateHorizonDays);
  const dates = calendarDays.filter((date) => {
    const weekday = parseDate(date).getUTCDay();
    return weekday >= 1 && weekday <= 5;
  });
  if (dates.length > bounds.maxWorkingDays) throw new Error("WORKING_DAY_LIMIT_EXCEEDED");
  const days = dates.map((onDate) =>
    getCapacitySnapshot(data, consultant, onDate, includePipeline, excludedDemandId),
  );
  const free = days.map((day) => day.rawFreeCapacity);
  const committed = days.map((day) => day.committedCapacity);
  const pipeline = days.map((day) => day.pipelineCapacity);
  const effective = days.map((day) => day.effectiveWorkingCapacity);
  const aggregate: CapacityRangeAggregate = {
    workingDaysConsidered: days.length,
    normalWorkingCapacity: average(days.map(() => consultant.workingCapacity)),
    effectiveWorkingCapacity: average(effective),
    committedCapacity: average(committed),
    pipelineCapacity: average(pipeline),
    averageFreeCapacity: average(free),
    minimumFreeCapacity: free.length ? Math.min(...free) : 0,
    maximumFreeCapacity: free.length ? Math.max(...free) : 0,
    averageCommittedCapacity: average(committed),
    averagePipelineCapacity: average(pipeline),
    unavailableDays: days.filter((day) => day.isUnavailable).length,
    overAllocatedDays: days.filter((day) => day.overAllocatedCapacity > 0).length,
    isAlwaysAvailable: days.length > 0 && days.every((day) => day.isAvailable),
    isAlwaysFree: days.length > 0 && days.every((day) => day.rawFreeCapacity > 0),
  };
  return { consultant, range, workingDays: dates, days, aggregate };
}

export function getTeamOverviewRange(
  data: CapacityDataSet,
  range: DateRange,
  includePipeline: boolean,
  bounds: RangeBounds = DEFAULT_RANGE_BOUNDS,
): TeamRangeResult {
  const dates = workingDates(range, bounds.maxDateHorizonDays);
  if (dates.length > bounds.maxWorkingDays) throw new Error("WORKING_DAY_LIMIT_EXCEEDED");
  const active = data.consultants.filter((consultant) => !consultant.archivedAt);
  const days = dates.map((onDate) => {
    const rows = active.map((consultant) =>
      getCapacitySnapshot(data, consultant, onDate, includePipeline),
    );
    const openDemands = data.demands.filter(
      (demand) =>
        demand.status !== "Lost" &&
        (includePipeline || demand.status !== "Incoming") &&
        demand.requiredCapacity > 0 &&
        demandOverlapsRange(
          { ...demand, ownerConsultantId: demand.owner?.id ?? null },
          onDate,
          onDate,
        ),
    );
    const gap = openDemands.reduce(
      (sum, demand) => sum + getStaffingSnapshot(data, demand).gapCapacity,
      0,
    );
    const effective = rows.reduce((sum, row) => sum + row.effectiveWorkingCapacity, 0);
    const committed = rows.reduce((sum, row) => sum + row.committedCapacity, 0);
    const pipeline = rows.reduce((sum, row) => sum + row.pipelineCapacity, 0);
    const scenario = committed + (includePipeline ? pipeline : 0);
    return {
      onDate,
      effectiveWorkingCapacity: effective,
      committedCapacity: committed,
      pipelineCapacity: pipeline,
      availableCapacity: Math.max(effective - scenario, 0),
      overAllocatedCapacity: Math.max(scenario - effective, 0),
      activeCount: active.length,
      unstaffedDemandGap: gap,
    };
  });
  const free = days.map(
    (day) =>
      day.effectiveWorkingCapacity -
      day.committedCapacity -
      (includePipeline ? day.pipelineCapacity : 0),
  );
  const overAllocatedPeople = active.flatMap((consultant) => {
    const count = dates.filter(
      (date) =>
        getCapacitySnapshot(data, consultant, date, includePipeline).overAllocatedCapacity > 0,
    ).length;
    return count ? [{ consultant, days: count }] : [];
  });
  const unavailablePeople = active.flatMap((consultant) => {
    const count = dates.filter(
      (date) => getCapacitySnapshot(data, consultant, date, includePipeline).isUnavailable,
    ).length;
    return count ? [{ consultant, days: count }] : [];
  });
  return {
    range,
    workingDays: dates,
    days,
    aggregate: {
      averageEffectiveWorkingCapacity: average(days.map((day) => day.effectiveWorkingCapacity)),
      averageCommittedCapacity: average(days.map((day) => day.committedCapacity)),
      averagePipelineCapacity: average(days.map((day) => day.pipelineCapacity)),
      averageFreeCapacity: average(free),
      minimumFreeCapacity: free.length ? Math.min(...free) : 0,
      maximumFreeCapacity: free.length ? Math.max(...free) : 0,
      overAllocatedPeople,
      unavailablePeople,
    },
  };
}

export function findAvailabilityWindows(
  data: CapacityDataSet,
  consultants: ConsultantDto[],
  searchRange: DateRange,
  minimumFreeCapacity: number,
  minimumWorkingDays: number,
  includePipeline: boolean,
  bounds: RangeBounds = DEFAULT_RANGE_BOUNDS,
): AvailabilityWindow[] {
  const dates = workingDates(searchRange, bounds.maxDateHorizonDays);
  if (dates.length > bounds.maxWorkingDays) throw new Error("WORKING_DAY_LIMIT_EXCEEDED");
  const windows: AvailabilityWindow[] = [];
  for (const consultant of consultants.filter((item) => !item.archivedAt)) {
    const snapshots = dates.map((date) =>
      getCapacitySnapshot(data, consultant, date, includePipeline),
    );
    for (let start = 0; start + minimumWorkingDays <= snapshots.length; start += 1) {
      const slice = snapshots.slice(start, start + minimumWorkingDays);
      const minimum = Math.min(...slice.map((item) => item.rawFreeCapacity));
      const staffable = slice.every(
        (item) => item.isAvailable && item.effectiveWorkingCapacity > 0,
      );
      if (staffable && minimum >= minimumFreeCapacity) {
        windows.push({
          consultant,
          range: { startDate: slice[0].onDate, endDate: slice.at(-1)!.onDate },
          workingDays: slice.length,
          minimumFreeCapacity: minimum,
          averageFreeCapacity: average(slice.map((item) => item.rawFreeCapacity)),
        });
        break;
      }
    }
    if (windows.length >= bounds.maxResultCount) break;
  }
  return windows;
}

export function findRangeStaffingCandidates(
  data: CapacityDataSet,
  demand: DemandDto,
  range: DateRange,
  includePipeline: boolean,
  minimumSkillMatches: number,
  bounds: RangeBounds = DEFAULT_RANGE_BOUNDS,
): RangeStaffingCandidate[] {
  const candidates = data.consultants
    .filter((consultant) => !consultant.archivedAt)
    .map((consultant) => {
      const rangeResult = getCapacityRange(
        data,
        consultant,
        range,
        includePipeline,
        bounds,
        demand.id,
      );
      const skillMatch = getSkillMatch(consultant.skills, demand.skills);
      const staffing = getStaffingSnapshot(data, demand);
      const requiredFreeCapacity = Math.min(Math.max(staffing.gapCapacity, 0), 100);
      return {
        consultant,
        range: rangeResult,
        skillMatch,
        requiredFreeCapacity,
        canCoverMinimum:
          rangeResult.days.length > 0 &&
          rangeResult.aggregate.minimumFreeCapacity >= requiredFreeCapacity &&
          rangeResult.days.every(
            (day) =>
              day.isAvailable &&
              day.effectiveWorkingCapacity > 0 &&
              day.rawFreeCapacity >= requiredFreeCapacity,
          ),
      };
    })
    .filter((candidate) => candidate.skillMatch.count >= minimumSkillMatches)
    .filter((candidate) => candidate.canCoverMinimum)
    .sort(
      (a, b) =>
        b.skillMatch.count - a.skillMatch.count ||
        b.range.aggregate.minimumFreeCapacity - a.range.aggregate.minimumFreeCapacity ||
        a.consultant.surname.localeCompare(b.consultant.surname) ||
        a.consultant.name.localeCompare(b.consultant.name) ||
        a.consultant.id.localeCompare(b.consultant.id),
    );
  return candidates.slice(0, bounds.maxResultCount);
}

export function demandOverlapsCapacityRange(demand: DemandDto, range: DateRange): boolean {
  return demandOverlapsRange(
    { ...demand, ownerConsultantId: demand.owner?.id ?? null },
    range.startDate,
    range.endDate,
  );
}
