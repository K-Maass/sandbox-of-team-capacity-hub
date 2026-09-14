import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  Allocation,
  Consultant,
  Demand,
  DemandStatus,
  DemandType,
  Level,
  Role,
} from "./types";

type ConsultantRow = {
  id: string;
  user_id: string | null;
  name: string;
  surname: string;
  email: string | null;
  level: string;
  role: string;
  skills: string[] | null;
  working_capacity: number;
};

type DemandRow = {
  id: string;
  title: string;
  client: string;
  type: string;
  status: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  required_capacity: number;
};

type AllocationRow = {
  id: string;
  demand_id: string;
  consultant_id: string;
  capacity: number;
};

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
});

const toDemand = (r: DemandRow): Demand => ({
  id: r.id,
  title: r.title,
  client: r.client,
  type: r.type as DemandType,
  status: r.status as DemandStatus,
  description: r.description,
  startDate: r.start_date,
  endDate: r.end_date,
  requiredCapacity: r.required_capacity,
});

const toAllocation = (r: AllocationRow): Allocation => ({
  id: r.id,
  demandId: r.demand_id,
  consultantId: r.consultant_id,
  capacity: r.capacity,
});

export const queryKeys = {
  consultants: ["consultants"] as const,
  demands: ["demands"] as const,
  allocations: ["allocations"] as const,
};

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export function useConsultants() {
  return useQuery({
    queryKey: queryKeys.consultants,
    queryFn: async () => {
      const res = await supabase
        .from("consultants")
        .select("id,user_id,name,surname,email,level,role,skills,working_capacity")
        .order("surname", { ascending: true });
      return unwrap<ConsultantRow[]>(res as never).map(toConsultant);
    },
  });
}

export function useDemands() {
  return useQuery({
    queryKey: queryKeys.demands,
    queryFn: async () => {
      const res = await supabase
        .from("demands")
        .select(
          "id,title,client,type,status,description,start_date,end_date,required_capacity",
        )
        .order("created_at", { ascending: false });
      return unwrap<DemandRow[]>(res as never).map(toDemand);
    },
  });
}

export function useAllocations() {
  return useQuery({
    queryKey: queryKeys.allocations,
    queryFn: async () => {
      const res = await supabase
        .from("allocations")
        .select("id,demand_id,consultant_id,capacity");
      return unwrap<AllocationRow[]>(res as never).map(toAllocation);
    },
  });
}

/** Everything the board, roster and analytics need. */
export function useBoardData() {
  const consultants = useConsultants();
  const demands = useDemands();
  const allocations = useAllocations();
  return {
    consultants: consultants.data ?? [],
    demands: demands.data ?? [],
    allocations: allocations.data ?? [],
    isLoading: consultants.isLoading || demands.isLoading || allocations.isLoading,
    error: consultants.error ?? demands.error ?? allocations.error ?? null,
  };
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
};

const consultantPayload = (input: Partial<ConsultantInput>) => {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.surname !== undefined) payload.surname = input.surname.trim();
  if (input.email !== undefined)
    payload.email = input.email ? input.email.trim().toLowerCase() : null;
  if (input.level !== undefined) payload.level = input.level;
  if (input.role !== undefined) payload.role = input.role;
  if (input.skills !== undefined) payload.skills = input.skills;
  if (input.workingCapacity !== undefined) payload.working_capacity = input.workingCapacity;
  if (input.userId !== undefined) payload.user_id = input.userId;
  return payload;
};

export function useCreateConsultant() {
  const invalidate = useInvalidate([queryKeys.consultants]);
  return useMutation({
    mutationFn: async (input: ConsultantInput) => {
      const { data, error } = await supabase
        .from("consultants")
        .insert(consultantPayload(input) as never)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data as { id: string };
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
        .update(consultantPayload(patch) as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useDeleteConsultant() {
  const invalidate = useInvalidate([queryKeys.consultants, queryKeys.allocations]);
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
  startDate: string | null;
  endDate: string | null;
  requiredCapacity: number;
};

const demandPayload = (input: Partial<DemandInput>) => {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.title = input.title.trim();
  if (input.client !== undefined) payload.client = input.client;
  if (input.type !== undefined) payload.type = input.type;
  if (input.status !== undefined) payload.status = input.status;
  if (input.description !== undefined) payload.description = input.description;
  if (input.startDate !== undefined) payload.start_date = input.startDate || null;
  if (input.endDate !== undefined) payload.end_date = input.endDate || null;
  if (input.requiredCapacity !== undefined)
    payload.required_capacity = input.requiredCapacity;
  return payload;
};

export function useCreateDemand() {
  const invalidate = useInvalidate([queryKeys.demands]);
  return useMutation({
    mutationFn: async (input: DemandInput) => {
      const { error } = await supabase.from("demands").insert(demandPayload(input) as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useUpdateDemand() {
  const invalidate = useInvalidate([queryKeys.demands]);
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<DemandInput> }) => {
      const { error } = await supabase
        .from("demands")
        .update(demandPayload(patch) as never)
        .eq("id", id);
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
      const { error } = await supabase.from("allocations").upsert(
        {
          demand_id: demandId,
          consultant_id: consultantId,
          capacity,
        } as never,
        { onConflict: "demand_id,consultant_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useDeallocate() {
  const invalidate = useInvalidate([queryKeys.allocations]);
  return useMutation({
    mutationFn: async ({
      demandId,
      consultantId,
    }: {
      demandId: string;
      consultantId: string;
    }) => {
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
