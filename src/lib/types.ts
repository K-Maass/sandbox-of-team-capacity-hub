export type Level = "Junior" | "Consultant" | "Senior" | "Manager" | "Partner";
export type Role =
  | "Strategy"
  | "Data"
  | "Engineering"
  | "Design"
  | "Product"
  | "Operations";

export type DemandType = "Project" | "Topic" | "RfP";
export type DemandStatus = "Incoming" | "In Progress" | "Won" | "Lost";

export interface Consultant {
  id: string;
  userId: string | null;
  name: string;
  surname: string;
  email: string | null;
  level: Level;
  role: Role;
  skills: string[];
  workingCapacity: number; // % 0-100
}

export interface Demand {
  id: string;
  title: string;
  client: string;
  type: DemandType;
  status: DemandStatus;
  description: string;
  startDate: string | null;
  endDate: string | null;
  requiredCapacity: number; // %
}

export interface Allocation {
  id: string;
  demandId: string;
  consultantId: string;
  capacity: number; // % 1-100
}

export const LEVELS: Level[] = ["Junior", "Consultant", "Senior", "Manager", "Partner"];
export const ROLES: Role[] = [
  "Strategy",
  "Data",
  "Engineering",
  "Design",
  "Product",
  "Operations",
];
export const DEMAND_TYPES: DemandType[] = ["Project", "Topic", "RfP"];
export const DEMAND_STATUSES: DemandStatus[] = ["Incoming", "In Progress", "Won", "Lost"];

/** Statuses that actually consume capacity. */
export const ACTIVE_STATUSES: DemandStatus[] = ["In Progress", "Won"];

export function allocationsFor(consultantId: string, allocations: Allocation[]) {
  return allocations.filter((a) => a.consultantId === consultantId);
}

/** Capacity used by a consultant across active demands. */
export function usedCapacity(
  consultantId: string,
  demands: Demand[],
  allocations: Allocation[],
): number {
  const activeIds = new Set(
    demands.filter((d) => ACTIVE_STATUSES.includes(d.status)).map((d) => d.id),
  );
  return allocations
    .filter((a) => a.consultantId === consultantId && activeIds.has(a.demandId))
    .reduce((sum, a) => sum + a.capacity, 0);
}

export function demandAllocations(demandId: string, allocations: Allocation[]) {
  return allocations.filter((a) => a.demandId === demandId);
}
