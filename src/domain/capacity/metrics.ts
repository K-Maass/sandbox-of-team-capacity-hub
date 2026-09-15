import type {
  ActionWarning,
  CapacityDataSet,
  CapacitySnapshot,
  ConsultantDto,
  DemandDto,
  StaffingSnapshot,
} from "./contracts";
import {
  availabilityBlockOnDate,
  demandConsumesCapacityOn,
  demandIsPipelineOn,
  pipelineCapacity,
  skillMatchCount,
  staffedCapacity,
  usedCapacity,
  workingCapacityOn,
} from "./rules";
import type { Allocation, AvailabilityBlock, Consultant, Demand } from "./types";

export function consultantModel(consultant: ConsultantDto): Consultant {
  return {
    id: consultant.id,
    userId: null,
    name: consultant.name,
    surname: consultant.surname,
    email: consultant.email,
    level: consultant.level,
    role: consultant.role,
    skills: consultant.skills,
    workingCapacity: consultant.workingCapacity,
    archivedAt: consultant.archivedAt,
  };
}

export function demandModel(demand: DemandDto): Demand {
  return {
    id: demand.id,
    title: demand.title,
    client: demand.client,
    type: demand.type,
    status: demand.status,
    description: demand.description,
    skills: demand.skills,
    startDate: demand.startDate,
    endDate: demand.endDate,
    requiredCapacity: demand.requiredCapacity,
    ownerConsultantId: demand.owner?.id ?? null,
  };
}

export function allocationModels(data: CapacityDataSet): Allocation[] {
  return data.allocations.map((allocation) => ({
    id: allocation.id,
    consultantId: allocation.consultantId,
    demandId: allocation.demandId,
    capacity: allocation.capacity,
  }));
}

export function blockModels(data: CapacityDataSet): AvailabilityBlock[] {
  return data.availabilityBlocks.map((block) => ({
    id: block.id,
    consultantId: block.consultantId,
    startDate: block.startDate,
    endDate: block.endDate,
    note: block.note,
  }));
}

export function demandModels(data: CapacityDataSet): Demand[] {
  return data.demands.map(demandModel);
}

export function consultantModels(data: CapacityDataSet): Consultant[] {
  return data.consultants.map(consultantModel);
}

export function getCapacitySnapshot(
  data: CapacityDataSet,
  consultant: ConsultantDto,
  onDate: string,
  includePipeline = false,
  excludedDemandId: string | null = null,
): CapacitySnapshot {
  const consultantValue = consultantModel(consultant);
  const demands = demandModels(data);
  const allocations = allocationModels(data);
  const blocks = blockModels(data);
  const unavailable = availabilityBlockOnDate(consultant.id, blocks, onDate);
  const effectiveWorkingCapacity = workingCapacityOn(consultantValue, blocks, onDate);
  const committedCapacity = usedCapacity(
    consultant.id,
    demands,
    allocations,
    onDate,
    excludedDemandId ?? undefined,
  );
  const pipeline = pipelineCapacity(
    consultant.id,
    demands,
    allocations,
    onDate,
    excludedDemandId ?? undefined,
  );
  const scenarioLoad = committedCapacity + (includePipeline ? pipeline : 0);
  const rawFreeCapacity = effectiveWorkingCapacity - scenarioLoad;
  return {
    onDate,
    includePipeline,
    excludedDemandId,
    normalWorkingCapacity: consultant.workingCapacity,
    effectiveWorkingCapacity,
    committedCapacity,
    pipelineCapacity: pipeline,
    scenarioLoad,
    rawFreeCapacity,
    availableCapacity: Math.max(rawFreeCapacity, 0),
    overAllocatedCapacity: Math.max(-rawFreeCapacity, 0),
    isArchived: !!consultant.archivedAt,
    isUnavailable: !!unavailable,
    isAvailable: !consultant.archivedAt && !unavailable && rawFreeCapacity > 0,
    availabilityBlockId: unavailable?.id ?? null,
  };
}

export function getStaffingSnapshot(data: CapacityDataSet, demand: DemandDto): StaffingSnapshot {
  const staffed = staffedCapacity(demand.id, allocationModels(data), consultantModels(data));
  const required = demand.requiredCapacity;
  return {
    requiredCapacity: required,
    staffedCapacity: staffed,
    gapCapacity: Math.max(required - staffed, 0),
    overTargetCapacity: Math.max(staffed - required, 0),
    staffingPercent: required > 0 ? Math.round((staffed / required) * 100) : null,
  };
}

export function getSkillMatch(
  consultantSkills: string[],
  demandSkills: string[],
): { count: number; matched: string[]; missing: string[] } {
  const consultantSet = new Set(consultantSkills.map((skill) => skill.toLowerCase()));
  return {
    count: skillMatchCount(consultantSkills, demandSkills),
    matched: demandSkills.filter((skill) => consultantSet.has(skill.toLowerCase())),
    missing: demandSkills.filter((skill) => !consultantSet.has(skill.toLowerCase())),
  };
}

export function capacityWarnings(
  data: CapacityDataSet,
  consultant: ConsultantDto,
  demand: DemandDto,
  capacity: number,
  onDate: string,
): ActionWarning[] {
  const warnings: ActionWarning[] = [];
  const isPipeline = demand.status === "Incoming";
  const base = getCapacitySnapshot(data, consultant, onDate, isPipeline, demand.id);
  const projectedFree = base.rawFreeCapacity - capacity;
  if (base.isUnavailable) {
    warnings.push({
      code: "UNAVAILABLE",
      message: `${consultant.name} ${consultant.surname} is unavailable on ${onDate}`,
    });
  }
  if (projectedFree < 0) {
    warnings.push({
      code: "OVER_ALLOCATION",
      message: `${consultant.name} ${consultant.surname} would be ${Math.abs(projectedFree)}% over capacity`,
    });
  }
  if (isPipeline) {
    warnings.push({
      code: "PIPELINE_EXPOSURE",
      message: "This allocation is pipeline and does not reserve committed capacity",
    });
  }
  return warnings;
}

export function activeAllocationDetails(
  data: CapacityDataSet,
  consultantId: string,
  onDate: string,
) {
  const demands = new Map(data.demands.map((demand) => [demand.id, demandModel(demand)]));
  return data.allocations.flatMap((allocation) => {
    if (allocation.consultantId !== consultantId) return [];
    const demand = demands.get(allocation.demandId);
    if (!demand) return [];
    const classification = demandConsumesCapacityOn(demand, onDate)
      ? "committed"
      : demandIsPipelineOn(demand, onDate)
        ? "pipeline"
        : null;
    return classification ? [{ allocation, demand, classification }] : [];
  });
}
