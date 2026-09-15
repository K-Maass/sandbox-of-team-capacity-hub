import {
  ACTIVE_STATUSES,
  DEMAND_STATUS_META,
  type Allocation,
  type AvailabilityBlock,
  type Consultant,
  type Demand,
  type DemandStatus,
} from "./types";

export function todayIsoDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "Open";
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

export function formatFte(capacity: number): string {
  const value = capacity / 100;
  return `${value.toFixed(Number.isInteger(value) ? 0 : 1)} FTE`;
}

export function demandStatusLabel(status: DemandStatus): string {
  return DEMAND_STATUS_META[status].label;
}

export function skillMatchCount(consultantSkills: string[], demandSkills: string[]): number {
  if (!demandSkills.length) return 0;
  const consultantSet = new Set(consultantSkills.map((skill) => skill.toLowerCase()));
  return demandSkills.filter((skill) => consultantSet.has(skill.toLowerCase())).length;
}

export function demandOverlapsDate(demand: Demand, onDate?: string): boolean {
  if (!onDate) return true;
  if (demand.startDate && onDate < demand.startDate) return false;
  if (demand.endDate && onDate > demand.endDate) return false;
  return true;
}

export function demandOverlapsRange(demand: Demand, startDate: string, endDate: string): boolean {
  if (demand.endDate && demand.endDate < startDate) return false;
  if (demand.startDate && demand.startDate > endDate) return false;
  return true;
}

export function demandConsumesCapacityOn(demand: Demand, onDate?: string): boolean {
  return ACTIVE_STATUSES.includes(demand.status) && demandOverlapsDate(demand, onDate);
}

export function demandIsPipelineOn(demand: Demand, onDate?: string): boolean {
  return demand.status === "Incoming" && demandOverlapsDate(demand, onDate);
}

export function usedCapacity(
  consultantId: string,
  demands: Demand[],
  allocations: Allocation[],
  onDate?: string,
  excludeDemandId?: string,
): number {
  const activeIds = new Set(
    demands
      .filter((demand) => demand.id !== excludeDemandId && demandConsumesCapacityOn(demand, onDate))
      .map((demand) => demand.id),
  );
  return allocations
    .filter(
      (allocation) =>
        allocation.consultantId === consultantId && activeIds.has(allocation.demandId),
    )
    .reduce((sum, allocation) => sum + allocation.capacity, 0);
}

export function pipelineCapacity(
  consultantId: string,
  demands: Demand[],
  allocations: Allocation[],
  onDate?: string,
  excludeDemandId?: string,
): number {
  const pipelineIds = new Set(
    demands
      .filter((demand) => demand.id !== excludeDemandId && demandIsPipelineOn(demand, onDate))
      .map((demand) => demand.id),
  );
  return allocations
    .filter(
      (allocation) =>
        allocation.consultantId === consultantId && pipelineIds.has(allocation.demandId),
    )
    .reduce((sum, allocation) => sum + allocation.capacity, 0);
}

export function availabilityBlockOnDate(
  consultantId: string,
  blocks: AvailabilityBlock[],
  onDate?: string,
): AvailabilityBlock | undefined {
  if (!onDate) return undefined;
  return blocks.find(
    (block) =>
      block.consultantId === consultantId && block.startDate <= onDate && block.endDate >= onDate,
  );
}

export function workingCapacityOn(
  consultant: Consultant,
  blocks: AvailabilityBlock[],
  onDate?: string,
): number {
  if (consultant.archivedAt) return 0;
  return availabilityBlockOnDate(consultant.id, blocks, onDate) ? 0 : consultant.workingCapacity;
}

export function freeCapacityOn(
  consultant: Consultant,
  demands: Demand[],
  allocations: Allocation[],
  blocks: AvailabilityBlock[],
  onDate: string,
  includePipeline = false,
): number {
  const base = workingCapacityOn(consultant, blocks, onDate);
  const committed = usedCapacity(consultant.id, demands, allocations, onDate);
  const pipeline = includePipeline
    ? pipelineCapacity(consultant.id, demands, allocations, onDate)
    : 0;
  return base - committed - pipeline;
}

export function demandAllocations(demandId: string, allocations: Allocation[]) {
  return allocations.filter((allocation) => allocation.demandId === demandId);
}

export function staffedCapacity(
  demandId: string,
  allocations: Allocation[],
  consultants: Consultant[],
): number {
  const activeIds = new Set(
    consultants.filter((consultant) => !consultant.archivedAt).map((consultant) => consultant.id),
  );
  return allocations
    .filter(
      (allocation) => allocation.demandId === demandId && activeIds.has(allocation.consultantId),
    )
    .reduce((sum, allocation) => sum + allocation.capacity, 0);
}
