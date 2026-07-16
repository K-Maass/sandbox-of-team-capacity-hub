import { useSyncExternalStore } from "react";

export type Level = "Junior" | "Consultant" | "Senior" | "Manager" | "Partner";
export type Role =
  | "Strategy"
  | "Data"
  | "Engineering"
  | "Design"
  | "Product"
  | "Operations";

export interface Consultant {
  id: string;
  name: string;
  surname: string;
  level: Level;
  role: Role;
}

export type DemandType = "Project" | "Topic" | "RfP";
export type DemandStatus = "Incoming" | "In Progress" | "Won" | "Lost";

export interface Allocation {
  consultantId: string;
  capacity: number; // % 0-100
}

export interface Demand {
  id: string;
  title: string;
  client: string;
  type: DemandType;
  status: DemandStatus;
  description?: string;
  startDate?: string;
  endDate?: string;
  allocations: Allocation[];
}

interface State {
  consultants: Consultant[];
  demands: Demand[];
}

const STORAGE_KEY = "capacity-board-v1";

const uid = () => Math.random().toString(36).slice(2, 10);

const seed: State = {
  consultants: [
    { id: uid(), name: "Ada", surname: "Lovelace", level: "Senior", role: "Engineering" },
    { id: uid(), name: "Marie", surname: "Curie", level: "Partner", role: "Strategy" },
    { id: uid(), name: "Alan", surname: "Turing", level: "Manager", role: "Data" },
    { id: uid(), name: "Grace", surname: "Hopper", level: "Consultant", role: "Product" },
    { id: uid(), name: "Linus", surname: "Pauling", level: "Junior", role: "Design" },
    { id: uid(), name: "Katherine", surname: "Johnson", level: "Senior", role: "Data" },
  ],
  demands: [],
};

let state: State = load();

function load(): State {
  if (typeof window === "undefined") return seed;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    return JSON.parse(raw) as State;
  } catch {
    return seed;
  }
}

function persist() {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const listeners = new Set<() => void>();
function emit() {
  persist();
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => seed,
  );
}

// ---- Actions ----
export const actions = {
  addConsultant(c: Omit<Consultant, "id">) {
    state = { ...state, consultants: [...state.consultants, { ...c, id: uid() }] };
    emit();
  },
  updateConsultant(id: string, patch: Partial<Consultant>) {
    state = {
      ...state,
      consultants: state.consultants.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    };
    emit();
  },
  removeConsultant(id: string) {
    state = {
      consultants: state.consultants.filter((c) => c.id !== id),
      demands: state.demands.map((d) => ({
        ...d,
        allocations: d.allocations.filter((a) => a.consultantId !== id),
      })),
    };
    emit();
  },
  addDemand(d: Omit<Demand, "id" | "allocations"> & { allocations?: Allocation[] }) {
    state = {
      ...state,
      demands: [
        ...state.demands,
        { ...d, id: uid(), allocations: d.allocations ?? [] },
      ],
    };
    emit();
  },
  updateDemand(id: string, patch: Partial<Demand>) {
    state = {
      ...state,
      demands: state.demands.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    };
    emit();
  },
  removeDemand(id: string) {
    state = { ...state, demands: state.demands.filter((d) => d.id !== id) };
    emit();
  },
  allocate(demandId: string, consultantId: string, capacity: number) {
    state = {
      ...state,
      demands: state.demands.map((d) => {
        if (d.id !== demandId) return d;
        const existing = d.allocations.find((a) => a.consultantId === consultantId);
        const allocations = existing
          ? d.allocations.map((a) =>
              a.consultantId === consultantId ? { ...a, capacity } : a,
            )
          : [...d.allocations, { consultantId, capacity }];
        return { ...d, allocations };
      }),
    };
    emit();
  },
  deallocate(demandId: string, consultantId: string) {
    state = {
      ...state,
      demands: state.demands.map((d) =>
        d.id === demandId
          ? { ...d, allocations: d.allocations.filter((a) => a.consultantId !== consultantId) }
          : d,
      ),
    };
    emit();
  },
};

// Derived helpers
export function usedCapacity(consultantId: string, demands: Demand[]): number {
  return demands
    .filter((d) => d.status === "In Progress" || d.status === "Won")
    .reduce(
      (sum, d) =>
        sum + (d.allocations.find((a) => a.consultantId === consultantId)?.capacity ?? 0),
      0,
    );
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
