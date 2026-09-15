import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { CapacityActionFailure } from "@/domain/capacity/errors";
import type {
  ActionPreview,
  AllocationDto,
  AvailabilityBlockDto,
  CapacityDataSet,
  ConsultantDto,
  DemandDto,
  ResolvedAction,
  RowVersion,
} from "@/domain/capacity/contracts";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type { CapacityRepository, RepositoryMutation } from "./repository";

type ConsultantRow = Tables<"consultants">;
type DemandRow = Tables<"demands">;
type AllocationRow = Tables<"allocations">;
type AvailabilityBlockRow = Tables<"availability_blocks">;

const CONSULTANT_COLUMNS =
  "id,user_id,name,surname,email,level,role,skills,working_capacity,archived_at,created_at,updated_at";
const DEMAND_COLUMNS =
  "id,title,client,type,status,description,skills,start_date,end_date,required_capacity,owner_consultant_id,created_at,updated_at";
const ALLOCATION_COLUMNS = "id,demand_id,consultant_id,capacity,created_at,updated_at";
const BLOCK_COLUMNS = "id,consultant_id,start_date,end_date,note,created_at,updated_at";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new CapacityActionFailure("UNAUTHORIZED", "Authentication is required");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new CapacityActionFailure("UNAUTHORIZED", "Authentication is required");
  return token;
}

function createUserClient(request: Request): SupabaseClient<Database> {
  const url = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !publishableKey) {
    throw new CapacityActionFailure("FORBIDDEN", "Capacity Hub data access is unavailable");
  }
  return createClient<Database>(url, publishableKey, {
    global: {
      fetch: createSupabaseFetch(publishableKey),
      headers: { Authorization: `Bearer ${bearerToken(request)}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

function consultantDto(row: ConsultantRow, actorUserId: string): ConsultantDto {
  return {
    id: row.id,
    name: row.name,
    surname: row.surname,
    email: row.email,
    level: row.level as ConsultantDto["level"],
    role: row.role as ConsultantDto["role"],
    skills: row.skills,
    workingCapacity: row.working_capacity,
    archivedAt: row.archived_at,
    linkedToUser: !!row.user_id,
    isCurrentUser: row.user_id === actorUserId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function demandDto(row: DemandRow, consultants: ConsultantDto[]): DemandDto {
  const owner = row.owner_consultant_id
    ? consultants.find((consultant) => consultant.id === row.owner_consultant_id)
    : null;
  return {
    id: row.id,
    title: row.title,
    client: row.client,
    type: row.type as DemandDto["type"],
    status: row.status as DemandDto["status"],
    description: row.description,
    skills: row.skills,
    startDate: row.start_date,
    endDate: row.end_date,
    requiredCapacity: row.required_capacity,
    owner: owner
      ? {
          id: owner.id,
          name: owner.name,
          surname: owner.surname,
          archivedAt: owner.archivedAt,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function allocationDto(row: AllocationRow): AllocationDto {
  return {
    id: row.id,
    demandId: row.demand_id,
    consultantId: row.consultant_id,
    capacity: row.capacity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function blockDto(row: AvailabilityBlockRow): AvailabilityBlockDto {
  return {
    id: row.id,
    consultantId: row.consultant_id,
    startDate: row.start_date,
    endDate: row.end_date,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function expectedVersion(preview: ActionPreview, table: RowVersion["table"], id: string): string {
  const version = preview.preconditions.find((item) => item.table === table && item.id === id);
  if (!version) throw new CapacityActionFailure("STALE_PREVIEW", "Preview is missing a version");
  return version.updatedAt;
}

function conflict(): never {
  throw new CapacityActionFailure("CONFLICT", "The requested change could not be applied");
}

function stale(): never {
  throw new CapacityActionFailure("STALE_PREVIEW", "The underlying data changed");
}

export class SupabaseCapacityRepository implements CapacityRepository {
  readonly #client: SupabaseClient<Database>;
  readonly #actorUserId: string;

  constructor(request: Request, actorUserId: string) {
    this.#client = createUserClient(request);
    this.#actorUserId = actorUserId;
  }

  async load(): Promise<CapacityDataSet> {
    const [consultantsResult, demandsResult, allocationsResult, blocksResult] = await Promise.all([
      this.#client.from("consultants").select(CONSULTANT_COLUMNS).order("surname"),
      this.#client.from("demands").select(DEMAND_COLUMNS).order("created_at", { ascending: false }),
      this.#client.from("allocations").select(ALLOCATION_COLUMNS),
      this.#client.from("availability_blocks").select(BLOCK_COLUMNS).order("start_date"),
    ]);
    if (
      consultantsResult.error ||
      demandsResult.error ||
      allocationsResult.error ||
      blocksResult.error
    ) {
      throw new CapacityActionFailure("FORBIDDEN", "Capacity Hub data could not be read");
    }
    const consultants = (consultantsResult.data as ConsultantRow[]).map((row) =>
      consultantDto(row, this.#actorUserId),
    );
    return {
      consultants,
      demands: (demandsResult.data as DemandRow[]).map((row) => demandDto(row, consultants)),
      allocations: (allocationsResult.data as AllocationRow[]).map(allocationDto),
      availabilityBlocks: (blocksResult.data as AvailabilityBlockRow[]).map(blockDto),
    };
  }

  async apply(
    action: ResolvedAction,
    preview: ActionPreview,
    actorUserId: string,
  ): Promise<RepositoryMutation> {
    if (actorUserId !== this.#actorUserId) {
      throw new CapacityActionFailure("FORBIDDEN", "Authenticated user context changed");
    }
    switch (action.kind) {
      case "updateConsultant": {
        const payload: TablesUpdate<"consultants"> = {};
        if (action.patch.name !== undefined) payload.name = action.patch.name;
        if (action.patch.surname !== undefined) payload.surname = action.patch.surname;
        if (action.patch.email !== undefined) payload.email = action.patch.email;
        if (action.patch.level !== undefined) payload.level = action.patch.level;
        if (action.patch.role !== undefined) payload.role = action.patch.role;
        if (action.patch.skills !== undefined) payload.skills = action.patch.skills;
        if (action.patch.workingCapacity !== undefined)
          payload.working_capacity = action.patch.workingCapacity;
        if (action.patch.archived !== undefined)
          payload.archived_at = action.patch.archived ? new Date().toISOString() : null;
        const version = expectedVersion(preview, "consultants", action.consultantId);
        const { data, error } = await this.#client
          .from("consultants")
          .update(payload)
          .eq("id", action.consultantId)
          .eq("updated_at", version)
          .select(CONSULTANT_COLUMNS)
          .maybeSingle();
        if (error) conflict();
        if (!data) stale();
        return {
          entityId: (data as ConsultantRow).id,
          changedFields: preview.changes.map((change) => change.field),
        };
      }
      case "createDemand": {
        const payload: TablesInsert<"demands"> = {
          title: action.demand.title,
          client: action.demand.client,
          type: action.demand.type,
          status: action.demand.status,
          description: action.demand.description,
          skills: action.demand.skills,
          start_date: action.demand.startDate,
          end_date: action.demand.endDate,
          required_capacity: action.demand.requiredCapacity,
          owner_consultant_id: action.demand.ownerConsultantId,
          created_by: actorUserId,
        };
        const { data, error } = await this.#client
          .from("demands")
          .insert(payload)
          .select(DEMAND_COLUMNS)
          .single();
        if (error || !data) conflict();
        return {
          entityId: (data as DemandRow).id,
          changedFields: preview.changes.map((change) => change.field),
        };
      }
      case "updateDemand": {
        const payload: TablesUpdate<"demands"> = {};
        const patch = action.patch;
        if (patch.title !== undefined) payload.title = patch.title;
        if (patch.client !== undefined) payload.client = patch.client;
        if (patch.type !== undefined) payload.type = patch.type;
        if (patch.status !== undefined) payload.status = patch.status;
        if (patch.description !== undefined) payload.description = patch.description;
        if (patch.skills !== undefined) payload.skills = patch.skills;
        if (patch.startDate !== undefined) payload.start_date = patch.startDate;
        if (patch.endDate !== undefined) payload.end_date = patch.endDate;
        if (patch.requiredCapacity !== undefined)
          payload.required_capacity = patch.requiredCapacity;
        if (patch.ownerConsultantId !== undefined)
          payload.owner_consultant_id = patch.ownerConsultantId;
        const version = expectedVersion(preview, "demands", action.demandId);
        const { data, error } = await this.#client
          .from("demands")
          .update(payload)
          .eq("id", action.demandId)
          .eq("updated_at", version)
          .select(DEMAND_COLUMNS)
          .maybeSingle();
        if (error) conflict();
        if (!data) stale();
        return {
          entityId: (data as DemandRow).id,
          changedFields: preview.changes.map((change) => change.field),
        };
      }
      case "setAllocation": {
        if (action.allocationId) {
          const version = expectedVersion(preview, "allocations", action.allocationId);
          const { data, error } = await this.#client
            .from("allocations")
            .update({ capacity: action.capacity })
            .eq("id", action.allocationId)
            .eq("updated_at", version)
            .select(ALLOCATION_COLUMNS)
            .maybeSingle();
          if (error) conflict();
          if (!data) stale();
          return {
            entityId: (data as AllocationRow).id,
            changedFields: preview.changes.map((change) => change.field),
          };
        }
        const { data, error } = await this.#client
          .from("allocations")
          .insert({
            consultant_id: action.consultantId,
            demand_id: action.demandId,
            capacity: action.capacity,
          })
          .select(ALLOCATION_COLUMNS)
          .single();
        if (error || !data) conflict();
        return {
          entityId: (data as AllocationRow).id,
          changedFields: ["capacity"],
        };
      }
      case "removeAllocation": {
        const version = expectedVersion(preview, "allocations", action.allocationId);
        const { data, error } = await this.#client
          .from("allocations")
          .delete()
          .eq("id", action.allocationId)
          .eq("updated_at", version)
          .select(ALLOCATION_COLUMNS)
          .maybeSingle();
        if (error) conflict();
        if (!data) stale();
        return {
          entityId: (data as AllocationRow).id,
          changedFields: ["allocation"],
        };
      }
      case "addAvailabilityBlock": {
        const { data, error } = await this.#client
          .from("availability_blocks")
          .insert({
            consultant_id: action.consultantId,
            start_date: action.startDate,
            end_date: action.endDate,
            note: action.note,
          })
          .select(BLOCK_COLUMNS)
          .single();
        if (error || !data) conflict();
        return {
          entityId: (data as AvailabilityBlockRow).id,
          changedFields: ["availabilityBlock"],
        };
      }
      case "removeAvailabilityBlock": {
        const version = expectedVersion(preview, "availability_blocks", action.availabilityBlockId);
        const { data, error } = await this.#client
          .from("availability_blocks")
          .delete()
          .eq("id", action.availabilityBlockId)
          .eq("updated_at", version)
          .select(BLOCK_COLUMNS)
          .maybeSingle();
        if (error) conflict();
        if (!data) stale();
        return {
          entityId: (data as AvailabilityBlockRow).id,
          changedFields: ["availabilityBlock"],
        };
      }
    }
  }
}
