import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type {
  Allocation,
  AvailabilityBlock,
  Consultant,
  Demand,
  DemandStatus,
  DemandType,
  Level,
  Role,
} from "./types";

type ConsultantRow = Tables<"consultants">;
type DemandRow = Tables<"demands">;
type AllocationRow = Tables<"allocations">;
type AvailabilityRow = Tables<"availability_blocks">;

const toConsultant = (r: ConsultantRow): Consultant => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  surname: r.surname,
  email: r.email,
  level: r.level as Level,
  role: r.role as Role,
  skills: r.skills ?? [],
  workingCapacity: r.working_capacity,
  archivedAt: r.archived_at,
});

const toDemand = (r: DemandRow): Demand => ({
  id: r.id,
  title: r.title,
  client: r.client,
  type: r.type as DemandType,
  status: r.status as DemandStatus,
  description: r.description,
  skills: r.skills ?? [],
  startDate: r.start_date,
  endDate: r.end_date,
  requiredCapacity: r.required_capacity,
  ownerConsultantId: r.owner_consultant_id,
});

const toAllocation = (r: AllocationRow): Allocation => ({
  id: r.id,
  demandId: r.demand_id,
  consultantId: r.consultant_id,
  capacity: r.capacity,
});

const toAvailabilityBlock = (r: AvailabilityRow): AvailabilityBlock => ({
  id: r.id,
  consultantId: r.consultant_id,
  startDate: r.start_date,
  endDate: r.end_date,
  note: r.note,
});

export const queryKeys = {
  consultants: ["consultants"] as const,
  demands: ["demands"] as const,
  allocations: ["allocations"] as const,
  availabilityBlocks: ["availability-blocks"] as const,
};

const sharedQueryOptions = {
  staleTime: 5_000,
  refetchInterval: 15_000,
  refetchOnWindowFocus: true,
} as const;

export function useConsultants() {
  return useQuery({
    queryKey: queryKeys.consultants,
    ...sharedQueryOptions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consultants")
        .select("id,user_id,name,surname,email,level,role,skills,working_capacity,archived_at")
        .order("surname", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => toConsultant(row as ConsultantRow));
    },
  });
}

export function useDemands() {
  return useQuery({
    queryKey: queryKeys.demands,
    ...sharedQueryOptions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demands")
        .select(
          "id,title,client,type,status,description,skills,start_date,end_date,required_capacity,owner_consultant_id,created_at,created_by,updated_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => toDemand(row as DemandRow));
    },
  });
}

export function useAllocations() {
  return useQuery({
    queryKey: queryKeys.allocations,
    ...sharedQueryOptions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("id,demand_id,consultant_id,capacity,created_at,updated_at");
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => toAllocation(row as AllocationRow));
    },
  });
}

export function useAvailabilityBlocks() {
  return useQuery({
    queryKey: queryKeys.availabilityBlocks,
    ...sharedQueryOptions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_blocks")
        .select("id,consultant_id,start_date,end_date,note,created_at,updated_at")
        .order("start_date", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => toAvailabilityBlock(row as AvailabilityRow));
    },
  });
}

/** Everything the board, roster, timeline and insights need. */
export function useBoardData() {
  const consultants = useConsultants();
  const demands = useDemands();
  const allocations = useAllocations();
  const availabilityBlocks = useAvailabilityBlocks();
  return {
    consultants: consultants.data ?? [],
    demands: demands.data ?? [],
    allocations: allocations.data ?? [],
    availabilityBlocks: availabilityBlocks.data ?? [],
    isLoading:
      consultants.isLoading ||
      demands.isLoading ||
      allocations.isLoading ||
      availabilityBlocks.isLoading,
    error:
      consultants.error ?? demands.error ?? allocations.error ?? availabilityBlocks.error ?? null,
  };
}

/**
 * Supabase Realtime makes shared edits visible immediately. The normal query polling
 * remains enabled as a resilient fallback if a client temporarily loses the realtime channel.
 */
export function useCapacityRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    const invalidate = (queryKey: readonly string[]) => {
      void qc.invalidateQueries({ queryKey });
    };

    const channel = supabase
      .channel(`capacity-board-live-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "consultants" }, () =>
        invalidate(queryKeys.consultants),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "demands" }, () =>
        invalidate(queryKeys.demands),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "allocations" }, () =>
        invalidate(queryKeys.allocations),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "availability_blocks" }, () =>
        invalidate(queryKeys.availabilityBlocks),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}

function useInvalidate(keys: readonly (readonly string[])[]) {
  const qc = useQueryClient();
  return () => keys.forEach((key) => qc.invalidateQueries({ queryKey: key }));
}

export type ConsultantInput = {
  name: string;
  surname: string;
  email?: string | null;
  level: Level;
  role: Role;
  skills?: string[];
  workingCapacity?: number;
  userId?: string | null;
  archivedAt?: string | null;
};

function consultantInsert(input: ConsultantInput): TablesInsert<"consultants"> {
  return {
    name: input.name.trim(),
    surname: input.surname.trim(),
    email: input.email ? input.email.trim().toLowerCase() : null,
    level: input.level,
    role: input.role,
    skills: input.skills ?? [],
    working_capacity: input.workingCapacity ?? 100,
    user_id: input.userId ?? null,
    archived_at: input.archivedAt ?? null,
  };
}

function consultantUpdate(input: Partial<ConsultantInput>): TablesUpdate<"consultants"> {
  const payload: TablesUpdate<"consultants"> = {};
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.surname !== undefined) payload.surname = input.surname.trim();
  if (input.email !== undefined)
    payload.email = input.email ? input.email.trim().toLowerCase() : null;
  if (input.level !== undefined) payload.level = input.level;
  if (input.role !== undefined) payload.role = input.role;
  if (input.skills !== undefined) payload.skills = input.skills;
  if (input.workingCapacity !== undefined) payload.working_capacity = input.workingCapacity;
  if (input.userId !== undefined) payload.user_id = input.userId;
  if (input.archivedAt !== undefined) payload.archived_at = input.archivedAt;
  return payload;
}

export function useCreateConsultant() {
  const invalidate = useInvalidate([queryKeys.consultants]);
  return useMutation({
    mutationFn: async (input: ConsultantInput) => {
      const { data, error } = await supabase
        .from("consultants")
        .insert(consultantInsert(input))
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateConsultant() {
  const invalidate = useInvalidate([queryKeys.consultants]);
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ConsultantInput> }) => {
      const { error } = await supabase
        .from("consultants")
        .update(consultantUpdate(patch))
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useDeleteConsultant() {
  const invalidate = useInvalidate([
    queryKeys.consultants,
    queryKeys.allocations,
    queryKeys.availabilityBlocks,
  ]);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("consultants").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export type DemandInput = {
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
};

function demandInsert(input: DemandInput, createdBy: string | null): TablesInsert<"demands"> {
  return {
    title: input.title.trim(),
    client: input.client.trim(),
    type: input.type,
    status: input.status,
    description: input.description.trim(),
    skills: input.skills,
    start_date: input.startDate || null,
    end_date: input.endDate || null,
    required_capacity: input.requiredCapacity,
    owner_consultant_id: input.ownerConsultantId,
    created_by: createdBy,
  };
}

function demandUpdate(input: Partial<DemandInput>): TablesUpdate<"demands"> {
  const payload: TablesUpdate<"demands"> = {};
  if (input.title !== undefined) payload.title = input.title.trim();
  if (input.client !== undefined) payload.client = input.client.trim();
  if (input.type !== undefined) payload.type = input.type;
  if (input.status !== undefined) payload.status = input.status;
  if (input.description !== undefined) payload.description = input.description.trim();
  if (input.skills !== undefined) payload.skills = input.skills;
  if (input.startDate !== undefined) payload.start_date = input.startDate || null;
  if (input.endDate !== undefined) payload.end_date = input.endDate || null;
  if (input.requiredCapacity !== undefined) payload.required_capacity = input.requiredCapacity;
  if (input.ownerConsultantId !== undefined) payload.owner_consultant_id = input.ownerConsultantId;
  return payload;
}

export function useCreateDemand() {
  const invalidate = useInvalidate([queryKeys.demands]);
  return useMutation({
    mutationFn: async (input: DemandInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("demands")
        .insert(demandInsert(input, user?.id ?? null));
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useUpdateDemand() {
  const invalidate = useInvalidate([queryKeys.demands]);
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<DemandInput> }) => {
      const { error } = await supabase.from("demands").update(demandUpdate(patch)).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useDeleteDemand() {
  const invalidate = useInvalidate([queryKeys.demands, queryKeys.allocations]);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("demands").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useAllocate() {
  const invalidate = useInvalidate([queryKeys.allocations]);
  return useMutation({
    mutationFn: async ({
      demandId,
      consultantId,
      capacity,
    }: {
      demandId: string;
      consultantId: string;
      capacity: number;
    }) => {
      const payload: TablesInsert<"allocations"> = {
        demand_id: demandId,
        consultant_id: consultantId,
        capacity,
      };
      const { error } = await supabase
        .from("allocations")
        .upsert(payload, { onConflict: "demand_id,consultant_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useDeallocate() {
  const invalidate = useInvalidate([queryKeys.allocations]);
  return useMutation({
    mutationFn: async ({ demandId, consultantId }: { demandId: string; consultantId: string }) => {
      const { error } = await supabase
        .from("allocations")
        .delete()
        .eq("demand_id", demandId)
        .eq("consultant_id", consultantId);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export type AvailabilityBlockInput = {
  consultantId: string;
  startDate: string;
  endDate: string;
  note?: string;
};

export function useCreateAvailabilityBlock() {
  const invalidate = useInvalidate([queryKeys.availabilityBlocks]);
  return useMutation({
    mutationFn: async (input: AvailabilityBlockInput) => {
      const payload: TablesInsert<"availability_blocks"> = {
        consultant_id: input.consultantId,
        start_date: input.startDate,
        end_date: input.endDate,
        note: input.note?.trim() ?? "",
      };
      const { error } = await supabase.from("availability_blocks").insert(payload);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useDeleteAvailabilityBlock() {
  const invalidate = useInvalidate([queryKeys.availabilityBlocks]);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("availability_blocks").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}
