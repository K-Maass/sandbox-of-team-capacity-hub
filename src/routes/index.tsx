import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import {
  actions,
  Demand,
  DemandStatus,
  useStore,
  usedCapacity,
} from "@/lib/store";
import { Avatar, CapacityBar, LevelBadge } from "@/components/consultant-bits";
import { Button } from "@/components/ui/button";
import { DemandDialog } from "@/components/demand-dialog";
import { AllocateDialog } from "@/components/allocate-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Briefcase,
  Building2,
  Calendar,
  MoreHorizontal,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Capacity Board — Team Allocation" },
      { name: "description", content: "Visual dashboard to manage consultant capacity and staff projects, topics and RfPs." },
      { property: "og:title", content: "Capacity Board" },
      { property: "og:description", content: "Visual dashboard to allocate consultants to demand." },
    ],
  }),
  component: Board,
});

const statusStyles: Record<DemandStatus, string> = {
  Incoming: "bg-info/15 text-info border-info/30",
  "In Progress": "bg-warning/20 text-warning-foreground border-warning/40",
  Won: "bg-success/20 text-success-foreground border-success/40",
  Lost: "bg-muted text-muted-foreground border-border",
};

const typeIcon = {
  Project: Briefcase,
  Topic: Users,
  RfP: Building2,
};

function Board() {
  const { consultants, demands } = useStore();
  const [allocDemand, setAllocDemand] = useState<{ id: string; consultantId?: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<DemandStatus | "All">("All");

  const filteredDemands = demands.filter(
    (d) => statusFilter === "All" || d.status === statusFilter,
  );

  const totalCapacity = consultants.length * 100;
  const usedTotal = consultants.reduce((s, c) => s + usedCapacity(c.id, demands), 0);
  const utilization = totalCapacity ? Math.round((usedTotal / totalCapacity) * 100) : 0;
  const available = Math.max(totalCapacity - usedTotal, 0);
  const activeDemands = demands.filter((d) => d.status !== "Lost").length;
  const openDemands = demands.filter((d) => d.status === "Incoming").length;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <div className="mx-auto max-w-[1600px] px-6 pb-10 pt-6">
        {/* Stats */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Team size" value={consultants.length.toString()} sub="consultants" />
          <StatCard label="Utilization" value={`${utilization}%`} sub={`${usedTotal}% used of ${totalCapacity}%`} accent />
          <StatCard label="Free capacity" value={`${available}%`} sub="ready to staff" />
          <StatCard label="Demands" value={activeDemands.toString()} sub={`${openDemands} incoming`} />
        </div>

        {/* Header row */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Staffing board</h1>
            <p className="text-sm text-muted-foreground">
              Match available consultants with incoming demand.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All statuses</SelectItem>
                <SelectItem value="Incoming">Incoming</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Won">Won</SelectItem>
                <SelectItem value="Lost">Lost</SelectItem>
              </SelectContent>
            </Select>
            <DemandDialog />
          </div>
        </div>

        {/* Two-column board */}
        <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          {/* Left: Consultants */}
          <section className="rounded-2xl border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Consultants</h2>
                <p className="text-xs text-muted-foreground">Sorted by free capacity</p>
              </div>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                {consultants.length}
              </span>
            </div>
            <div className="space-y-2">
              {[...consultants]
                .sort((a, b) => usedCapacity(a.id, demands) - usedCapacity(b.id, demands))
                .map((c) => {
                  const used = usedCapacity(c.id, demands);
                  const free = 100 - used;
                  return (
                    <div key={c.id} className="rounded-xl border bg-card p-3">
                      <div className="flex items-start gap-3">
                        <Avatar consultant={c} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold">
                              {c.name} {c.surname}
                            </p>
                            <LevelBadge level={c.level} />
                          </div>
                          <p className="text-xs text-muted-foreground">{c.role}</p>
                        </div>
                        <span
                          className={
                            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums " +
                            (free <= 0
                              ? "bg-destructive/15 text-destructive"
                              : free <= 25
                                ? "bg-warning/25 text-warning-foreground"
                                : "bg-success/20 text-success-foreground")
                          }
                        >
                          {free > 0 ? `${free}% free` : "Full"}
                        </span>
                      </div>
                      <div className="mt-3">
                        <CapacityBar used={used} />
                      </div>
                    </div>
                  );
                })}
              {consultants.length === 0 && (
                <EmptyState
                  icon={<Users className="h-5 w-5" />}
                  title="No consultants yet"
                  hint="Add your team in the Consultants tab."
                />
              )}
            </div>
          </section>

          {/* Right: Demands */}
          <section className="rounded-2xl border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Demand pipeline</h2>
                <p className="text-xs text-muted-foreground">
                  Projects, topics and RfPs waiting for a team.
                </p>
              </div>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                {filteredDemands.length}
              </span>
            </div>

            {filteredDemands.length === 0 ? (
              <EmptyState
                icon={<Briefcase className="h-5 w-5" />}
                title="No demand in this view"
                hint="Create your first project, topic or RfP."
                action={<DemandDialog trigger={<Button size="sm"><Plus className="h-4 w-4" /> New demand</Button>} />}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredDemands.map((d) => (
                  <DemandCard
                    key={d.id}
                    demand={d}
                    consultants={consultants}
                    onAllocate={(consultantId) => setAllocDemand({ id: d.id, consultantId })}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {allocDemand && (
        <AllocateDialog
          demandId={allocDemand.id}
          open={!!allocDemand}
          onOpenChange={(o) => !o && setAllocDemand(null)}
          preselectConsultantId={allocDemand.consultantId}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={"rounded-2xl border p-4 " + (accent ? "bg-primary text-primary-foreground" : "bg-surface")}>
      <p className={"text-xs uppercase tracking-wide " + (accent ? "text-primary-foreground/70" : "text-muted-foreground")}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className={"mt-1 text-xs " + (accent ? "text-primary-foreground/70" : "text-muted-foreground")}>{sub}</p>}
    </div>
  );
}

function DemandCard({
  demand,
  consultants,
  onAllocate,
}: {
  demand: Demand;
  consultants: ReturnType<typeof useStore>["consultants"];
  onAllocate: (consultantId?: string) => void;
}) {
  const Icon = typeIcon[demand.type];
  const totalAllocated = demand.allocations.reduce((s, a) => s + a.capacity, 0);
  return (
    <div className="group flex flex-col rounded-xl border bg-card p-4 transition hover:shadow-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " + statusStyles[demand.status]}>
            <Icon className="h-3 w-3" />
            {demand.type}
          </span>
          <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium " + statusStyles[demand.status]}>
            {demand.status}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-secondary group-hover:opacity-100">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(["Incoming", "In Progress", "Won", "Lost"] as DemandStatus[]).map((s) => (
              <DropdownMenuItem key={s} onClick={() => actions.updateDemand(demand.id, { status: s })}>
                Mark {s}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => actions.removeDemand(demand.id)}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <h3 className="text-sm font-semibold leading-snug">{demand.title}</h3>
      {demand.client && (
        <p className="mt-0.5 text-xs text-muted-foreground">{demand.client}</p>
      )}
      {demand.description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{demand.description}</p>
      )}

      {(demand.startDate || demand.endDate) && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {demand.startDate ?? "?"} → {demand.endDate ?? "?"}
        </div>
      )}

      <div className="mt-3 flex-1">
        {demand.allocations.length > 0 ? (
          <div className="space-y-1.5">
            {demand.allocations.map((a) => {
              const c = consultants.find((x) => x.id === a.consultantId);
              if (!c) return null;
              return (
                <button
                  key={a.consultantId}
                  onClick={() => onAllocate(a.consultantId)}
                  className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-secondary/60"
                >
                  <Avatar consultant={c} size={28} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {c.name} {c.surname}
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold tabular-nums">
                    {a.capacity}%
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">No one allocated yet</p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t pt-3">
        <span className="text-[11px] text-muted-foreground">
          {demand.allocations.length} people · {totalAllocated}%
        </span>
        <Button size="sm" variant="secondary" onClick={() => onAllocate(undefined)}>
          <UserPlus className="h-3.5 w-3.5" /> Allocate
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
      <div className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-secondary text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
