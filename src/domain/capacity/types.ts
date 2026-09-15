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
  workingCapacity: number;
  archivedAt: string | null;
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
  requiredCapacity: number;
  ownerConsultantId: string | null;
}

export interface Allocation {
  id: string;
  demandId: string;
  consultantId: string;
  capacity: number;
}

export interface AvailabilityBlock {
  id: string;
  consultantId: string;
  startDate: string;
  endDate: string;
  note: string;
}

export const LEVELS: Level[] = ["Junior", "Consultant", "Senior", "Manager", "Partner"];
export const ROLES: Role[] = ["Strategy", "Data", "Engineering", "Design", "Product", "Operations"];
export const DEMAND_TYPES: DemandType[] = ["Project", "Topic", "RfP"];
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

export const ACTIVE_STATUSES: DemandStatus[] = ["In Progress", "Won"];
