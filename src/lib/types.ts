export type Level = "Junior" | "Consultant" | "Senior" | "Manager" | "Partner";
export type Role = "Strategy" | "Data" | "Engineering" | "Design" | "Product" | "Operations";

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
  skills: string[];
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
export const ROLES: Role[] = ["Strategy", "Data", "Engineering", "Design", "Product", "Operations"];
export const DEMAND_TYPES: DemandType[] = ["Project", "Topic", "RfP"];

/** Stored values stay unchanged for backwards compatibility; labels are intentionally simpler. */
export const DEMAND_STATUSES: DemandStatus[] = ["Incoming", "Won", "In Progress", "Lost"];
export const DEMAND_STATUS_META: Record<
  DemandStatus,
  { label: string; description: string; consumesCapacity: boolean }
> = {
  Incoming: {
    label: "Pipeline",
    description: "Tentative staffing — does not reserve capacity",
    consumesCapacity: false,
  },
  Won: {
    label: "Confirmed",
    description: "Committed work — reserves capacity",
    consumesCapacity: true,
  },
  "In Progress": {
    label: "Active",
    description: "Currently in delivery — reserves capacity",
    consumesCapacity: true,
  },
  Lost: {
    label: "Closed",
    description: "Finished or no longer proceeding",
    consumesCapacity: false,
  },
};

/** Statuses that consume staffing capacity. */
export const ACTIVE_STATUSES: DemandStatus[] = ["In Progress", "Won"];

/** Local calendar date in YYYY-MM-DD form, suitable for date inputs and Postgres DATE values. */
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

/** Whether a date sits inside a demand's optional date window. */
export function demandOverlapsDate(demand: Demand, onDate?: string): boolean {
  if (!onDate) return true;
  if (demand.startDate && onDate < demand.startDate) return false;
  if (demand.endDate && onDate > demand.endDate) return false;
  return true;
}

/**
 * A demand consumes capacity on a date only when it is active and the date is
 * within its optional start/end window. Missing boundaries are treated as open-ended.
 */
export function demandConsumesCapacityOn(demand: Demand, onDate?: string): boolean {
  return ACTIVE_STATUSES.includes(demand.status) && demandOverlapsDate(demand, onDate);
}

/** Capacity used by a consultant on a selected date. */
export function usedCapacity(
  consultantId: string,
  demands: Demand[],
  allocations: Allocation[],
  onDate?: string,
  excludeDemandId?: string,
): number {
  const activeIds = new Set(
    demands
      .filter((d) => d.id !== excludeDemandId && demandConsumesCapacityOn(d, onDate))
      .map((d) => d.id),
  );
  return allocations
    .filter((a) => a.consultantId === consultantId && activeIds.has(a.demandId))
    .reduce((sum, a) => sum + a.capacity, 0);
}

export function demandAllocations(demandId: string, allocations: Allocation[]) {
  return allocations.filter((a) => a.demandId === demandId);
}
