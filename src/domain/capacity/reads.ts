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
import { demandOverlapsDate } from "./rules";
import { resolveConsultant, resolveDemand } from "./resolution";

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

export function executeReadAction(action: ReadAction, data: CapacityDataSet) {
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

    case "findStaffingCandidates": {
      const demand = resolveDemand(action.demand, data.demands, { field: "demand" });
      const candidates = data.consultants
        .filter((consultant) => !consultant.archivedAt)
        .map((consultant) => {
          const capacity = getCapacitySnapshot(
            data,
            consultant,
            action.onDate,
            action.includePipeline,
            demand.id,
          );
          const skillMatch = getSkillMatch(consultant.skills, demand.skills);
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
          return { consultant: summary(consultant), capacity, skillMatch, warnings };
        })
        .filter((candidate) => candidate.skillMatch.count >= (action.minimumSkillMatches ?? 0))
        .sort(
          (a, b) =>
            b.skillMatch.count - a.skillMatch.count ||
            b.capacity.rawFreeCapacity - a.capacity.rawFreeCapacity ||
            a.consultant.surname.localeCompare(b.consultant.surname) ||
            a.consultant.name.localeCompare(b.consultant.name) ||
            a.consultant.id.localeCompare(b.consultant.id),
        )
        .slice(0, action.limit ?? 20);
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
