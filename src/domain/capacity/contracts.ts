import type { DemandStatus, DemandType, Level, Role } from "./types";

export type UUID = string;
export type ISODate = string;
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ConsultantRef = { consultantId: UUID } | { email: string } | { name: string };

export type DemandRef = { demandId: UUID } | { title: string; client?: string };

export type AvailabilityBlockRef =
  | { availabilityBlockId: UUID }
  | { consultant: ConsultantRef; startDate: ISODate; endDate: ISODate };

export type ActionErrorCode =
  | "AMBIGUOUS_REFERENCE"
  | "CONFLICT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_PREVIEW"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

export type ActionError = {
  code: ActionErrorCode;
  message: string;
  field?: string;
  candidates?: Array<{ id: UUID; label: string; secondary?: string }>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export type ConsultantDto = {
  id: UUID;
  name: string;
  surname: string;
  email: string | null;
  level: Level;
  role: Role;
  skills: string[];
  workingCapacity: number;
  archivedAt: string | null;
  linkedToUser: boolean;
  isCurrentUser: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConsultantSummary = Pick<
  ConsultantDto,
  "archivedAt" | "id" | "level" | "name" | "role" | "skills" | "surname" | "workingCapacity"
>;

export type DemandOwnerDto = Pick<ConsultantDto, "archivedAt" | "id" | "name" | "surname">;

export type DemandDto = {
  id: UUID;
  title: string;
  client: string;
  type: DemandType;
  status: DemandStatus;
  description: string;
  skills: string[];
  startDate: ISODate | null;
  endDate: ISODate | null;
  requiredCapacity: number;
  owner: DemandOwnerDto | null;
  createdAt: string;
  updatedAt: string;
};

export type AllocationDto = {
  id: UUID;
  demandId: UUID;
  consultantId: UUID;
  capacity: number;
  createdAt: string;
  updatedAt: string;
};

export type AvailabilityBlockDto = {
  id: UUID;
  consultantId: UUID;
  startDate: ISODate;
  endDate: ISODate;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type CapacitySnapshot = {
  onDate: ISODate;
  includePipeline: boolean;
  excludedDemandId: UUID | null;
  normalWorkingCapacity: number;
  effectiveWorkingCapacity: number;
  committedCapacity: number;
  pipelineCapacity: number;
  scenarioLoad: number;
  rawFreeCapacity: number;
  availableCapacity: number;
  overAllocatedCapacity: number;
  isArchived: boolean;
  isUnavailable: boolean;
  isAvailable: boolean;
  availabilityBlockId: UUID | null;
};

export type CapacityDataSet = {
  consultants: ConsultantDto[];
  demands: DemandDto[];
  allocations: AllocationDto[];
  availabilityBlocks: AvailabilityBlockDto[];
};

export type StaffingSnapshot = {
  requiredCapacity: number;
  staffedCapacity: number;
  gapCapacity: number;
  overTargetCapacity: number;
  staffingPercent: number | null;
};

export type StaffingCandidate = {
  consultant: ConsultantSummary;
  capacity: CapacitySnapshot;
  skillMatch: {
    count: number;
    matched: string[];
    missing: string[];
  };
  warnings: ActionWarning[];
};

export type ListConsultantsAction = {
  kind: "listConsultants";
  status?: "active" | "archived" | "all";
  role?: Role;
  level?: Level;
  skills?: { anyOf?: string[]; allOf?: string[] };
  onDate?: ISODate;
  includePipeline?: boolean;
};

export type GetConsultantAction = {
  kind: "getConsultant";
  consultant: ConsultantRef;
  onDate?: ISODate;
  includePipeline?: boolean;
};

export type ListDemandsAction = {
  kind: "listDemands";
  statuses?: DemandStatus[];
  types?: DemandType[];
  owner?: ConsultantRef;
  activeOn?: ISODate;
  skills?: string[];
  includeClosed?: boolean;
};

export type GetDemandAction = {
  kind: "getDemand";
  demand: DemandRef;
  onDate?: ISODate;
};

export type GetCapacityAction = {
  kind: "getCapacity";
  consultant: ConsultantRef;
  onDate: ISODate;
  includePipeline?: boolean;
};

export type FindStaffingCandidatesAction = {
  kind: "findStaffingCandidates";
  demand: DemandRef;
  onDate: ISODate;
  includePipeline?: boolean;
  minimumSkillMatches?: number;
  limit?: number;
};

export type GetTeamOverviewAction = {
  kind: "getTeamOverview";
  onDate: ISODate;
  includePipeline?: boolean;
};

export type ReadAction =
  | FindStaffingCandidatesAction
  | GetCapacityAction
  | GetConsultantAction
  | GetDemandAction
  | GetTeamOverviewAction
  | ListConsultantsAction
  | ListDemandsAction;

export type CreateDemandFields = {
  title: string;
  client?: string;
  type?: DemandType;
  status?: DemandStatus;
  description?: string;
  skills?: string[];
  startDate?: ISODate | null;
  endDate?: ISODate | null;
  requiredCapacity?: number;
  owner?: ConsultantRef | null;
};

export type ProposedAction =
  | {
      kind: "updateConsultant";
      consultant: ConsultantRef;
      patch: {
        name?: string;
        surname?: string;
        email?: string | null;
        level?: Level;
        role?: Role;
        skills?: string[];
        workingCapacity?: number;
        archived?: boolean;
      };
    }
  | { kind: "createDemand"; demand: CreateDemandFields }
  | { kind: "updateDemand"; demand: DemandRef; patch: Partial<CreateDemandFields> }
  | {
      kind: "setAllocation";
      consultant: ConsultantRef;
      demand: DemandRef;
      capacity: number;
    }
  | { kind: "removeAllocation"; consultant: ConsultantRef; demand: DemandRef }
  | {
      kind: "addAvailabilityBlock";
      consultant: ConsultantRef;
      startDate: ISODate;
      endDate: ISODate;
      note?: string;
    }
  | { kind: "removeAvailabilityBlock"; block: AvailabilityBlockRef };

export type ResolvedAction =
  | {
      kind: "updateConsultant";
      consultantId: UUID;
      patch: Extract<ProposedAction, { kind: "updateConsultant" }>["patch"];
    }
  | {
      kind: "createDemand";
      demand: Omit<CreateDemandFields, "owner"> & { ownerConsultantId: UUID | null };
    }
  | {
      kind: "updateDemand";
      demandId: UUID;
      patch: Omit<Partial<CreateDemandFields>, "owner"> & { ownerConsultantId?: UUID | null };
    }
  | {
      kind: "setAllocation";
      allocationId: UUID | null;
      consultantId: UUID;
      demandId: UUID;
      capacity: number;
    }
  | {
      kind: "removeAllocation";
      allocationId: UUID;
      consultantId: UUID;
      demandId: UUID;
    }
  | {
      kind: "addAvailabilityBlock";
      consultantId: UUID;
      startDate: ISODate;
      endDate: ISODate;
      note: string;
    }
  | { kind: "removeAvailabilityBlock"; availabilityBlockId: UUID };

export type ActionWarning = {
  code:
    | "AFFECTED_ACTIVE_WORK"
    | "ARCHIVE_WITH_HISTORY"
    | "OVER_ALLOCATION"
    | "PIPELINE_EXPOSURE"
    | "UNAVAILABLE";
  message: string;
};

export type FieldChange = { field: string; before: JsonValue; after: JsonValue };

export type ActionImpact = {
  capacity: Array<{
    consultantId: UUID;
    before: CapacitySnapshot;
    after: CapacitySnapshot;
  }>;
  staffing: Array<{
    demandId: UUID | null;
    before: StaffingSnapshot;
    after: StaffingSnapshot;
  }>;
  affectedAllocations: Array<{
    allocationId: UUID | null;
    consultantId: UUID;
    demandId: UUID;
    capacity: number;
  }>;
};

export type RowVersion = {
  table: "allocations" | "availability_blocks" | "consultants" | "demands";
  id: UUID;
  updatedAt: string;
};

export type ActionPreview = {
  phase: "preview";
  previewId: string;
  action: ResolvedAction;
  asOfDate: ISODate;
  changes: FieldChange[];
  impact: ActionImpact;
  warnings: ActionWarning[];
  preconditions: RowVersion[];
  dependencyFingerprint: string;
  requiresConfirmation: true;
  confirmationText: string;
};

export type MutationResult = {
  phase: "executed";
  actionKind: ProposedAction["kind"];
  changed: boolean;
  changedFields: string[];
  before: JsonValue | null;
  after: JsonValue | null;
  actualImpact: ActionImpact;
  executedAt: string;
};

export type CapacityActionRequest =
  | { mode: "read"; action: ReadAction }
  | { mode: "preview"; action: ProposedAction; asOfDate: ISODate }
  | {
      mode: "confirm";
      confirmed: true;
      action: ProposedAction;
      asOfDate: ISODate;
      previewId: string;
    };
