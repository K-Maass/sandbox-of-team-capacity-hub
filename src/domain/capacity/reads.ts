import type {
  ActionWarning,
  CapacityDataSet,
  ConsultantDto,
  ConsultantSummary,
  ReadAction,
} from "./contracts";
import {
  activeAllocationDetails,
  getCapacitySnapshot,
  getSkillMatch,
  getStaffingSnapshot,
} from "./metrics";
import { demandOverlapsDate, demandOverlapsRange } from "./rules";
import {
  DEFAULT_RANGE_BOUNDS,
  findAvailabilityWindows,
  findRangeStaffingCandidates,
  getCapacityRange,
  getTeamOverviewRange,
  type RangeBounds,
} from "./ranges";
import { resolveConsultant, resolveDemand } from "./resolution";
import { CapacityActionFailure } from "./errors";
import { isDateRangeOrdered } from "./form-validation";

function summary(consultant: ConsultantDto): ConsultantSummary {
  return {
    id: consultant.id,
    name: consultant.name,
    surname: consultant.surname,
    level: consultant.level,
    role: consultant.role,
    skills: consultant.skills,
    workingCapacity: consultant.workingCapacity,
    archivedAt: consultant.archivedAt,
  };
}

function sortConsultants(consultants: ConsultantDto[]): ConsultantDto[] {
  return [...consultants].sort(
    (a, b) =>
      a.surname.localeCompare(b.surname) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

function hasSkill(consultantSkills: string[], requested: string): boolean {
  return consultantSkills.some((skill) => skill.toLowerCase() === requested.toLowerCase());
}

function skillKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function executeReadAction(
  action: ReadAction,
  data: CapacityDataSet,
  bounds: RangeBounds = DEFAULT_RANGE_BOUNDS,
) {
  if (
    "startDate" in action &&
    "endDate" in action &&
    !isDateRangeOrdered(action.startDate, action.endDate)
  ) {
    throw new CapacityActionFailure("VALIDATION_ERROR", "End date cannot be before start date", {
      field: "endDate",
    });
  }
  switch (action.kind) {
    case "listConsultants": {
      let consultants = data.consultants.filter((consultant) => {
        if (action.status === "active" && consultant.archivedAt) return false;
        if (action.status === "archived" && !consultant.archivedAt) return false;
        if (action.role && consultant.role !== action.role) return false;
        if (action.level && consultant.level !== action.level) return false;
        if (action.skills?.anyOf?.length) {
          if (!action.skills.anyOf.some((skill) => hasSkill(consultant.skills, skill)))
            return false;
        }
        if (action.skills?.allOf?.length) {
          if (!action.skills.allOf.every((skill) => hasSkill(consultant.skills, skill)))
            return false;
        }
        return true;
      });
      consultants = sortConsultants(consultants);
      return {
        consultants: consultants.map((consultant) => ({
          consultant,
          capacity: action.onDate
            ? getCapacitySnapshot(data, consultant, action.onDate, action.includePipeline)
            : null,
        })),
        count: consultants.length,
      };
    }

    case "getConsultant": {
      const consultant = resolveConsultant(action.consultant, data.consultants, {
        field: "consultant",
      });
      const allocations = data.allocations
        .filter((allocation) => allocation.consultantId === consultant.id)
        .flatMap((allocation) => {
          const demand = data.demands.find((item) => item.id === allocation.demandId);
          return demand
            ? [
                {
                  allocationId: allocation.id,
                  capacity: allocation.capacity,
                  updatedAt: allocation.updatedAt,
                  demand,
                },
              ]
            : [];
        });
      return {
        consultant,
        capacity: action.onDate
          ? getCapacitySnapshot(data, consultant, action.onDate, action.includePipeline)
          : null,
        allocations,
        availabilityBlocks: data.availabilityBlocks
          .filter((block) => block.consultantId === consultant.id)
          .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)),
      };
    }

    case "listDemands": {
      const owner = action.owner
        ? resolveConsultant(action.owner, data.consultants, { field: "owner" })
        : null;
      const demands = data.demands.filter((demand) => {
        if (!action.includeClosed && demand.status === "Lost") return false;
        if (action.statuses?.length && !action.statuses.includes(demand.status)) return false;
        if (action.types?.length && !action.types.includes(demand.type)) return false;
        if (owner && demand.owner?.id !== owner.id) return false;
        if (
          action.activeOn &&
          !demandOverlapsDate(
            { ...demand, ownerConsultantId: demand.owner?.id ?? null },
            action.activeOn,
          )
        )
          return false;
        if (
          action.skills?.length &&
          !action.skills.every((skill) => hasSkill(demand.skills, skill))
        )
          return false;
        return true;
      });
      return {
        demands: demands.map((demand) => ({ demand, staffing: getStaffingSnapshot(data, demand) })),
        count: demands.length,
      };
    }

    case "getDemand": {
      const demand = resolveDemand(action.demand, data.demands, { field: "demand" });
      return {
        demand,
        staffing: getStaffingSnapshot(data, demand),
        isActiveOn: action.onDate
          ? demandOverlapsDate(
              { ...demand, ownerConsultantId: demand.owner?.id ?? null },
              action.onDate,
            )
          : null,
        allocations: data.allocations
          .filter((allocation) => allocation.demandId === demand.id)
          .flatMap((allocation) => {
            const consultant = data.consultants.find((item) => item.id === allocation.consultantId);
            return consultant
              ? [
                  {
                    allocationId: allocation.id,
                    consultant: summary(consultant),
                    capacity: allocation.capacity,
                    updatedAt: allocation.updatedAt,
                    countsTowardStaffing: !consultant.archivedAt,
                  },
                ]
              : [];
          }),
      };
    }

    case "getCapacity": {
      const consultant = resolveConsultant(action.consultant, data.consultants, {
        field: "consultant",
      });
      const activeAllocations = activeAllocationDetails(data, consultant.id, action.onDate)
        .filter((item) => action.includePipeline || item.classification === "committed")
        .map((item) => ({
          demand: data.demands.find((demand) => demand.id === item.demand.id)!,
          capacity: item.allocation.capacity,
          classification: item.classification,
        }));
      return {
        consultant,
        capacity: getCapacitySnapshot(data, consultant, action.onDate, action.includePipeline),
        activeAllocations,
      };
    }

    case "getCapacityRange": {
      const consultant = resolveConsultant(action.consultant, data.consultants, {
        field: "consultant",
      });
      const range = { startDate: action.startDate, endDate: action.endDate };
      const workingDays = getCapacityRange(
        data,
        consultant,
        range,
        action.includePipeline ?? false,
        bounds,
      ).workingDays;
      return {
        consultant,
        range: getCapacityRange(data, consultant, range, action.includePipeline ?? false, bounds),
        allocations: data.allocations.flatMap((allocation) => {
          if (allocation.consultantId !== consultant.id) return [];
          const demand = data.demands.find((item) => item.id === allocation.demandId);
          if (!demand) return [];
          const activeDays = workingDays.filter((day) =>
            demandOverlapsDate({ ...demand, ownerConsultantId: demand.owner?.id ?? null }, day),
          );
          const classification =
            demand.status === "Incoming"
              ? "pipeline"
              : demand.status === "Won" || demand.status === "In Progress"
                ? "committed"
                : null;
          return classification &&
            activeDays.length &&
            (classification !== "pipeline" || action.includePipeline)
            ? [{ demand: demand.title, capacity: allocation.capacity, activeDays, classification }]
            : [];
        }),
        focus: action.focus ?? "free",
      };
    }

    case "getTeamOverviewRange": {
      const result = getTeamOverviewRange(
        data,
        { startDate: action.startDate, endDate: action.endDate },
        action.includePipeline ?? false,
        bounds,
      );
      if (!action.role && !action.level) return result;
      const filtered = data.consultants.filter(
        (consultant) =>
          !consultant.archivedAt &&
          (!action.role || consultant.role === action.role) &&
          (!action.level || consultant.level === action.level),
      );
      const people = new Set(filtered.map((consultant) => consultant.id));
      const filteredDays = result.days.map((day) => {
        const rows = filtered.map((consultant) =>
          getCapacitySnapshot(data, consultant, day.onDate, action.includePipeline ?? false),
        );
        const effective = rows.reduce((sum, row) => sum + row.effectiveWorkingCapacity, 0);
        const committed = rows.reduce((sum, row) => sum + row.committedCapacity, 0);
        const pipeline = rows.reduce((sum, row) => sum + row.pipelineCapacity, 0);
        const scenario = committed + (action.includePipeline ? pipeline : 0);
        const filteredGap = data.demands
          .filter(
            (demand) =>
              demand.status !== "Lost" &&
              (action.includePipeline || demand.status !== "Incoming") &&
              demand.requiredCapacity > 0 &&
              demandOverlapsDate(
                { ...demand, ownerConsultantId: demand.owner?.id ?? null },
                day.onDate,
              ),
          )
          .reduce((sum, demand) => {
            const staffed = data.allocations
              .filter(
                (allocation) =>
                  allocation.demandId === demand.id && people.has(allocation.consultantId),
              )
              .reduce((allocationSum, allocation) => allocationSum + allocation.capacity, 0);
            return sum + Math.max(demand.requiredCapacity - staffed, 0);
          }, 0);
        return {
          ...day,
          effectiveWorkingCapacity: effective,
          committedCapacity: committed,
          pipelineCapacity: pipeline,
          availableCapacity: Math.max(effective - scenario, 0),
          overAllocatedCapacity: Math.max(scenario - effective, 0),
          activeCount: filtered.length,
          unstaffedDemandGap: filteredGap,
        };
      });
      const filteredFree = filteredDays.map(
        (day) =>
          day.effectiveWorkingCapacity -
          day.committedCapacity -
          (action.includePipeline ? day.pipelineCapacity : 0),
      );
      return {
        ...result,
        days: filteredDays,
        aggregate: {
          ...result.aggregate,
          averageEffectiveWorkingCapacity: filteredDays.length
            ? filteredDays.reduce((sum, day) => sum + day.effectiveWorkingCapacity, 0) /
              filteredDays.length
            : 0,
          averageCommittedCapacity: filteredDays.length
            ? filteredDays.reduce((sum, day) => sum + day.committedCapacity, 0) /
              filteredDays.length
            : 0,
          averagePipelineCapacity: filteredDays.length
            ? filteredDays.reduce((sum, day) => sum + day.pipelineCapacity, 0) / filteredDays.length
            : 0,
          averageFreeCapacity: filteredFree.length
            ? filteredFree.reduce((sum, value) => sum + value, 0) / filteredFree.length
            : 0,
          minimumFreeCapacity: filteredFree.length ? Math.min(...filteredFree) : 0,
          maximumFreeCapacity: filteredFree.length ? Math.max(...filteredFree) : 0,
          overAllocatedPeople: result.aggregate.overAllocatedPeople.filter((item) =>
            people.has(item.consultant.id),
          ),
          unavailablePeople: result.aggregate.unavailablePeople.filter((item) =>
            people.has(item.consultant.id),
          ),
        },
      };
    }

    case "findAvailabilityWindows": {
      const consultants = action.consultant
        ? [
            resolveConsultant(action.consultant, data.consultants, {
              activeOnly: true,
              field: "consultant",
            }),
          ]
        : data.consultants;
      return {
        windows: findAvailabilityWindows(
          data,
          consultants,
          { startDate: action.startDate, endDate: action.endDate },
          action.minimumFreeCapacity,
          action.minimumWorkingDays,
          action.includePipeline ?? false,
          bounds,
        ),
      };
    }

    case "findStaffingCandidatesRange": {
      const demand = resolveDemand(action.demand, data.demands, { field: "demand" });
      if (demand.status === "Incoming" && !action.includePipeline) {
        return {
          demand,
          range: { startDate: action.startDate, endDate: action.endDate },
          candidates: [],
        };
      }
      return {
        demand,
        range: { startDate: action.startDate, endDate: action.endDate },
        candidates: findRangeStaffingCandidates(
          data,
          demand,
          { startDate: action.startDate, endDate: action.endDate },
          action.includePipeline ?? false,
          action.minimumSkillMatches ?? 0,
          {
            ...bounds,
            maxResultCount: Math.min(action.limit ?? bounds.maxResultCount, bounds.maxResultCount),
          },
        ),
      };
    }

    case "findSuitableDemands": {
      const consultant = resolveConsultant(action.consultant, data.consultants, {
        activeOnly: true,
        field: "consultant",
      });
      const range = { startDate: action.startDate, endDate: action.endDate };
      const demands = data.demands
        .filter(
          (demand) =>
            demand.status !== "Lost" &&
            (action.includePipeline || demand.status !== "Incoming") &&
            demand.requiredCapacity > 0 &&
            demandOverlapsRange(
              { ...demand, ownerConsultantId: demand.owner?.id ?? null },
              range.startDate,
              range.endDate,
            ),
        )
        .map((demand) => {
          const capacity = getCapacityRange(
            data,
            consultant,
            range,
            action.includePipeline ?? false,
            bounds,
            demand.id,
          );
          return {
            demand,
            staffing: getStaffingSnapshot(data, demand),
            skillMatch: getSkillMatch(consultant.skills, demand.skills),
            minimumFreeCapacity: capacity.aggregate.minimumFreeCapacity,
            canCoverRange:
              capacity.days.length > 0 &&
              capacity.days.every((day) => day.isAvailable && day.effectiveWorkingCapacity > 0) &&
              capacity.aggregate.minimumFreeCapacity >=
                Math.min(Math.max(getStaffingSnapshot(data, demand).gapCapacity, 0), 100),
          };
        })
        .filter(
          (candidate) =>
            candidate.staffing.gapCapacity > 0 &&
            candidate.skillMatch.count ===
              new Set(candidate.demand.skills.map((skill) => skill.toLowerCase())).size &&
            candidate.canCoverRange,
        )
        .sort(
          (a, b) =>
            b.skillMatch.count - a.skillMatch.count ||
            b.staffing.gapCapacity - a.staffing.gapCapacity ||
            Number(b.canCoverRange) - Number(a.canCoverRange) ||
            a.demand.title.localeCompare(b.demand.title) ||
            a.demand.id.localeCompare(b.demand.id),
        )
        .slice(0, Math.min(action.limit ?? bounds.maxResultCount, bounds.maxResultCount));
      return { consultant, range, demands };
    }

    case "skillSupplyDemand": {
      const requested = action.skill ? skillKey(action.skill) : undefined;
      const normalizedSkills = new Map<string, string>();
      for (const skill of [
        ...data.consultants.flatMap((consultant) => consultant.skills),
        ...data.demands.flatMap((demand) => demand.skills),
      ]) {
        const label = skill.trim().replace(/\s+/g, " ");
        const key = skillKey(label);
        if (label && !normalizedSkills.has(key)) normalizedSkills.set(key, label);
      }
      const skills = Array.from(normalizedSkills.entries())
        .filter(([key]) => !requested || key === requested)
        .map(([, label]) => label)
        .slice(0, bounds.maxResultCount);
      return {
        range: { startDate: action.startDate, endDate: action.endDate },
        skills: skills.map((skill) => ({
          skill,
          consultants: data.consultants.filter(
            (consultant) =>
              !consultant.archivedAt &&
              consultant.skills.some((item) => skillKey(item) === skillKey(skill)),
          ).length,
          demandCount: data.demands.filter(
            (demand) =>
              demand.status !== "Lost" &&
              (action.includePipeline || demand.status !== "Incoming") &&
              demand.skills.some((item) => skillKey(item) === skillKey(skill)) &&
              demandOverlapsRange(
                { ...demand, ownerConsultantId: demand.owner?.id ?? null },
                action.startDate,
                action.endDate,
              ),
          ).length,
        })),
      };
    }

    case "productHelp":
      return { topic: action.topic };

    case "findStaffingCandidates": {
      const demand = resolveDemand(action.demand, data.demands, { field: "demand" });
      if (demand.status === "Incoming" && !action.includePipeline) {
        return { demand, candidates: [] };
      }
      const candidates = data.consultants
        .filter((consultant) => !consultant.archivedAt)
        .map((consultant) => {
          const capacity = getCapacitySnapshot(
            data,
            consultant,
            action.onDate,
            action.includePipeline ?? false,
            demand.id,
          );
          const skillMatch = getSkillMatch(consultant.skills, demand.skills);
          const requiredFreeCapacity = Math.min(
            Math.max(getStaffingSnapshot(data, demand).gapCapacity, 0),
            100,
          );
          const warnings: ActionWarning[] = [];
          if (capacity.isUnavailable) {
            warnings.push({
              code: "UNAVAILABLE",
              message: `${consultant.name} ${consultant.surname} is unavailable on ${action.onDate}`,
            });
          }
          if (capacity.overAllocatedCapacity > 0) {
            warnings.push({
              code: "OVER_ALLOCATION",
              message: `${consultant.name} ${consultant.surname} is already over capacity`,
            });
          }
          if (demand.status === "Incoming") {
            warnings.push({
              code: "PIPELINE_EXPOSURE",
              message: "This demand is pipeline and does not reserve committed capacity",
            });
          }
          return {
            consultant: summary(consultant),
            capacity,
            skillMatch,
            warnings,
            feasible:
              capacity.isAvailable &&
              capacity.effectiveWorkingCapacity > 0 &&
              capacity.rawFreeCapacity >= requiredFreeCapacity,
          };
        })
        .filter((candidate) => candidate.skillMatch.count >= (action.minimumSkillMatches ?? 0))
        .filter((candidate) => candidate.feasible)
        .sort(
          (a, b) =>
            b.skillMatch.count - a.skillMatch.count ||
            b.capacity.rawFreeCapacity - a.capacity.rawFreeCapacity ||
            a.consultant.surname.localeCompare(b.consultant.surname) ||
            a.consultant.name.localeCompare(b.consultant.name) ||
            a.consultant.id.localeCompare(b.consultant.id),
        )
        .slice(0, action.limit ?? bounds.defaultResultCount);
      return { demand, candidates };
    }

    case "getTeamOverview": {
      const activeConsultants = data.consultants.filter((consultant) => !consultant.archivedAt);
      const capacityRows = activeConsultants.map((consultant) => ({
        consultant,
        capacity: getCapacitySnapshot(data, consultant, action.onDate, action.includePipeline),
      }));
      const openDemands = data.demands.filter(
        (demand) =>
          demand.status !== "Lost" &&
          (action.includePipeline || demand.status !== "Incoming") &&
          demand.requiredCapacity > 0 &&
          demandOverlapsDate(
            { ...demand, ownerConsultantId: demand.owner?.id ?? null },
            action.onDate,
          ),
      );
      const demandRows = openDemands.map((demand) => ({
        demand,
        staffing: getStaffingSnapshot(data, demand),
      }));
      const effectiveWorkingCapacity = capacityRows.reduce(
        (sum, row) => sum + row.capacity.effectiveWorkingCapacity,
        0,
      );
      const committedCapacity = capacityRows.reduce(
        (sum, row) => sum + row.capacity.committedCapacity,
        0,
      );
      const pipelineCapacity = capacityRows.reduce(
        (sum, row) => sum + row.capacity.pipelineCapacity,
        0,
      );
      const scenarioLoad = committedCapacity + (action.includePipeline ? pipelineCapacity : 0);
      const rawFreeCapacity = effectiveWorkingCapacity - scenarioLoad;
      return {
        team: {
          activeCount: activeConsultants.length,
          archivedCount: data.consultants.length - activeConsultants.length,
          effectiveWorkingCapacity,
          committedCapacity,
          pipelineCapacity,
          scenarioLoad,
          rawFreeCapacity,
          availableCapacity: Math.max(rawFreeCapacity, 0),
          overAllocatedCapacity: Math.max(-rawFreeCapacity, 0),
        },
        demand: {
          requiredCapacity: demandRows.reduce((sum, row) => sum + row.staffing.requiredCapacity, 0),
          staffedCapacity: demandRows.reduce((sum, row) => sum + row.staffing.staffedCapacity, 0),
          gapCapacity: demandRows.reduce((sum, row) => sum + row.staffing.gapCapacity, 0),
        },
        overAllocatedConsultants: capacityRows
          .filter((row) => row.capacity.overAllocatedCapacity > 0)
          .map((row) => ({ consultant: summary(row.consultant), capacity: row.capacity })),
        unstaffedDemands: demandRows.filter((row) => row.staffing.gapCapacity > 0),
      };
    }
  }
}
