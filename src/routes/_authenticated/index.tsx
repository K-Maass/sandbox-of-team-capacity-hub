import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import { DataError } from "@/components/data-error";
import {
  DEMAND_STATUSES,
  DEMAND_STATUS_META,
  demandConsumesCapacityOn,
  demandOverlapsDate,
  demandStatusLabel,
  formatDate,
  formatFte,
  todayIsoDate,
  usedCapacity,
  type Consultant,
  type Demand,
  type DemandStatus,
} from "@/lib/types";
import { useBoardData, useDeleteDemand, useUpdateDemand } from "@/lib/data";
import { useSession } from "@/lib/auth";
import { Avatar, CapacityBar, LevelBadge } from "@/components/consultant-bits";
import { SkillChips } from "@/components/skill-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Pencil,
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

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Capacity Board — Team Allocation" },
      {
        name: "description",
        content: "Shared dashboard to see availability, staffing gaps and team allocations.",
      },
      { property: "og:title", content: "Capacity Board" },
      {
        property: "og:description",
        content: "Shared dashboard to match available people with demand.",
      },
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
  const { consultants, demands, allocations, isLoading, error } = useBoardData();
  const { user } = useSession();
  const navigate = useNavigate();
  const [allocDemand, setAllocDemand] = useState<{ id: string; consultantId?: string } | null>(
    null,
  );
  const [statusFilter, setStatusFilter] = useState<DemandStatus | "All">("All");
  const [capacityDate, setCapacityDate] = useState(todayIsoDate);
  const [expandedConsultantId, setExpandedConsultantId] = useState<string | null>(null);

  const linked = user ? consultants.some((c) => c.userId === user.id) : true;

  useEffect(() => {
    if (!isLoading && !error && user && !linked) {
      void navigate({ to: "/profile", replace: true });
    }
  }, [isLoading, error, user, linked, navigate]);

  const filteredDemands = demands.filter(
    (d) => statusFilter === "All" || d.status === statusFilter,
  );

  const totalCapacity = consultants.reduce(
    (sum, consultant) => sum + consultant.workingCapacity,
    0,
  );
  const usedTotal = consultants.reduce(
    (sum, consultant) => sum + usedCapacity(consultant.id, demands, allocations, capacityDate),
    0,
  );
  const utilization = totalCapacity ? Math.round((usedTotal / totalCapacity) * 100) : 0;
  const available = Math.max(totalCapacity - usedTotal, 0);
  const skillSuggestions = Array.from(
    new Set([
      ...consultants.flatMap((consultant) => consultant.skills),
      ...demands.flatMap((demand) => demand.skills),
    ]),
  );

  const unstaffedDemand = demands
    .filter(
      (d) => d.status !== "Lost" && d.requiredCapacity > 0 && demandOverlapsDate(d, capacityDate),
    )
    .reduce((sum, demand) => {
      const staffed = allocations
        .filter((allocation) => allocation.demandId === demand.id)
        .reduce((value, allocation) => value + allocation.capacity, 0);
      return sum + Math.max(demand.requiredCapacity - staffed, 0);
    }, 0);

  if (!isLoading && user && !linked) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="mx-auto flex max-w-xl items-center justify-center gap-2 px-6 py-24 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Opening your quick team setup…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <div className="mx-auto max-w-[1600px] px-6 pb-10 pt-6">
        <DataError error={error} />

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Team"
            value={consultants.length.toString()}
            sub={consultants.length === 1 ? "person" : "people"}
          />
          <StatCard
            label="Utilization"
            value={totalCapacity ? `${utilization}%` : "—"}
            sub={
              totalCapacity
                ? `${usedTotal}% allocated of ${totalCapacity}% capacity`
                : "Add your team to get started"
            }
            accent
          />
          <StatCard
            label="Available"
            value={totalCapacity ? formatFte(available) : "—"}
            sub={totalCapacity ? `${available}% ready to staff` : "No team capacity yet"}
          />
          <StatCard
            label="Unstaffed demand"
            value={demands.length ? formatFte(unstaffedDemand) : "—"}
            sub={demands.length ? `${unstaffedDemand}% staffing gap` : "No demand yet"}
          />
        </div>

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Staffing board</h1>
            <p className="text-sm text-muted-foreground">
              See who is free, what needs staffing, and match the two.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Capacity on
              <Input
                type="date"
                value={capacityDate}
                onChange={(e) => setCapacityDate(e.target.value || todayIsoDate())}
                className="w-40 bg-surface text-sm font-normal normal-case tracking-normal text-foreground"
              />
            </label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as DemandStatus | "All")}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All statuses</SelectItem>
                {DEMAND_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {demandStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DemandDialog skillSuggestions={skillSuggestions} />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border bg-surface p-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading shared board…
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
            <section className="rounded-2xl border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Team</h2>
                  <p className="text-xs text-muted-foreground">
                    Most available first · click for current work
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                  {consultants.length}
                </span>
              </div>
              <div className="space-y-2">
                {[...consultants]
                  .sort(
                    (a, b) =>
                      b.workingCapacity -
                      usedCapacity(b.id, demands, allocations, capacityDate) -
                      (a.workingCapacity - usedCapacity(a.id, demands, allocations, capacityDate)),
                  )
                  .map((consultant) => {
                    const used = usedCapacity(consultant.id, demands, allocations, capacityDate);
                    const free = consultant.workingCapacity - used;
                    const currentWork = allocations
                      .filter((allocation) => allocation.consultantId === consultant.id)
                      .map((allocation) => ({
                        allocation,
                        demand: demands.find((demand) => demand.id === allocation.demandId),
                      }))
                      .filter(
                        (
                          item,
                        ): item is { allocation: (typeof allocations)[number]; demand: Demand } =>
                          !!item.demand && demandConsumesCapacityOn(item.demand, capacityDate),
                      );
                    const expanded = expandedConsultantId === consultant.id;
                    return (
                      <div
                        key={consultant.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/consultant-id", consultant.id);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => setExpandedConsultantId(expanded ? null : consultant.id)}
                        className="cursor-grab rounded-xl border bg-card p-3 transition active:cursor-grabbing hover:border-primary/40 hover:shadow-sm"
                        title="Click for current work, or drag onto a demand to allocate"
                      >
                        <div className="flex items-start gap-3">
                          <Avatar consultant={consultant} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold">
                                {consultant.name} {consultant.surname}
                              </p>
                              <LevelBadge level={consultant.level} />
                            </div>
                            <p className="text-xs text-muted-foreground">{consultant.role}</p>
                            <SkillChips skills={consultant.skills} limit={3} className="mt-1.5" />
                          </div>
                          <div className="flex items-center gap-1.5">
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
                              {free > 0
                                ? `${free}% free`
                                : free === 0
                                  ? "Full"
                                  : `${Math.abs(free)}% over`}
                            </span>
                            <ChevronDown
                              className={`h-3.5 w-3.5 text-muted-foreground transition ${expanded ? "rotate-180" : ""}`}
                            />
                          </div>
                        </div>
                        <div className="mt-3">
                          <CapacityBar used={used} max={consultant.workingCapacity} />
                        </div>
                        {expanded && (
                          <div
                            className="mt-3 border-t pt-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>Current work on {formatDate(capacityDate)}</span>
                              <span>{used}% allocated</span>
                            </div>
                            {currentWork.length ? (
                              <div className="space-y-1">
                                {currentWork.map(({ allocation, demand }) => (
                                  <div
                                    key={allocation.id}
                                    className="flex items-center justify-between gap-2 text-xs"
                                  >
                                    <span className="truncate">{demand.title}</span>
                                    <span className="shrink-0 font-medium tabular-nums">
                                      {allocation.capacity}%
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                No active allocations on this date.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                {consultants.length === 0 && (
                  <EmptyState
                    icon={<Users className="h-5 w-5" />}
                    title="No team members yet"
                    hint="Add yourself or add someone manually in Team."
                    action={
                      <Button asChild size="sm" variant="secondary">
                        <Link to="/profile">Join the team</Link>
                      </Button>
                    }
                  />
                )}
              </div>
            </section>

            <section className="rounded-2xl border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Demand</h2>
                  <p className="text-xs text-muted-foreground">
                    Projects, topics and RfPs that need people.
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
                  hint="Create demand with the button above when work needs staffing."
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredDemands.map((demand) => (
                    <DemandCard
                      key={demand.id}
                      demand={demand}
                      consultants={consultants}
                      allocations={allocations.filter(
                        (allocation) => allocation.demandId === demand.id,
                      )}
                      onAllocate={(consultantId) => setAllocDemand({ id: demand.id, consultantId })}
                      skillSuggestions={skillSuggestions}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {allocDemand && (
        <AllocateDialog
          demandId={allocDemand.id}
          open={!!allocDemand}
          onOpenChange={(nextOpen) => !nextOpen && setAllocDemand(null)}
          preselectConsultantId={allocDemand.consultantId}
          asOfDate={capacityDate}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border p-4 " + (accent ? "bg-primary text-primary-foreground" : "bg-surface")
      }
    >
      <p
        className={
          "text-xs uppercase tracking-wide " +
          (accent ? "text-primary-foreground/70" : "text-muted-foreground")
        }
      >
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && (
        <p
          className={
            "mt-1 text-xs " + (accent ? "text-primary-foreground/70" : "text-muted-foreground")
          }
        >
          {sub}
        </p>
      )}
    </div>
  );
}

function DemandCard({
  demand,
  consultants,
  allocations,
  onAllocate,
  skillSuggestions,
}: {
  demand: Demand;
  consultants: Consultant[];
  allocations: { id: string; consultantId: string; capacity: number }[];
  onAllocate: (consultantId?: string) => void;
  skillSuggestions: string[];
}) {
  const Icon = typeIcon[demand.type];
  const totalAllocated = allocations.reduce((sum, allocation) => sum + allocation.capacity, 0);
  const gap = Math.max(demand.requiredCapacity - totalAllocated, 0);
  const over = Math.max(totalAllocated - demand.requiredCapacity, 0);
  const isClosed = demand.status === "Lost";
  const [dragOver, setDragOver] = useState(false);
  const updateDemand = useUpdateDemand();
  const deleteDemand = useDeleteDemand();

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/consultant-id")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const consultantId = e.dataTransfer.getData("text/consultant-id");
        if (consultantId) onAllocate(consultantId);
      }}
      className={
        "group flex flex-col rounded-xl border bg-card p-4 transition hover:shadow-md " +
        (dragOver ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "")
      }
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyles[demand.status]}`}
          >
            <Icon className="h-3 w-3" /> {demand.type}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyles[demand.status]}`}
            title={DEMAND_STATUS_META[demand.status].description}
          >
            {demandStatusLabel(demand.status)}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-secondary group-hover:opacity-100">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {DEMAND_STATUSES.map((status) => (
              <DropdownMenuItem
                key={status}
                onClick={() => updateDemand.mutate({ id: demand.id, patch: { status } })}
              >
                Mark {demandStatusLabel(status)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                if (confirm(`Delete “${demand.title}”?`)) deleteDemand.mutate(demand.id);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <h3 className="text-sm font-semibold leading-snug">{demand.title}</h3>
      {demand.client && <p className="mt-0.5 text-xs text-muted-foreground">{demand.client}</p>}
      {(demand.startDate || demand.endDate) && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {formatDate(demand.startDate)} → {formatDate(demand.endDate)}
        </div>
      )}
      <SkillChips skills={demand.skills} limit={4} className="mt-2" />
      {demand.description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{demand.description}</p>
      )}

      <div className="mt-3 flex-1">
        {allocations.length > 0 ? (
          <div className="space-y-1.5">
            {allocations.map((allocation) => {
              const consultant = consultants.find((item) => item.id === allocation.consultantId);
              if (!consultant) return null;
              return (
                <button
                  key={allocation.id}
                  onClick={() => onAllocate(allocation.consultantId)}
                  className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-secondary/60"
                >
                  <Avatar consultant={consultant} size={28} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {consultant.name} {consultant.surname}
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold tabular-nums">
                    {allocation.capacity}%
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">No one allocated yet</p>
        )}
      </div>

      {demand.requiredCapacity > 0 && (
        <div className="mt-3 rounded-lg bg-muted/30 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p
                className={`text-xs font-semibold ${
                  isClosed
                    ? "text-muted-foreground"
                    : gap > 0
                      ? "text-warning-foreground"
                      : over > 0
                        ? "text-destructive"
                        : "text-success-foreground"
                }`}
              >
                {isClosed
                  ? "Closed"
                  : gap > 0
                    ? `${gap}% still needed`
                    : over > 0
                      ? `${over}% over target`
                      : "Fully staffed"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {totalAllocated}% staffed of {demand.requiredCapacity}% ·{" "}
                {formatFte(demand.requiredCapacity)} required
              </p>
            </div>
          </div>
          <div className="mt-2">
            <CapacityBar used={totalAllocated} max={demand.requiredCapacity} />
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t pt-3">
        <span className="text-[11px] text-muted-foreground">
          {allocations.length} {allocations.length === 1 ? "person" : "people"} · {totalAllocated}%
        </span>
        <div className="flex items-center gap-1">
          <DemandDialog
            demand={demand}
            skillSuggestions={skillSuggestions}
            trigger={
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit demand">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <Button size="sm" variant="secondary" onClick={() => onAllocate(undefined)}>
            <UserPlus className="h-3.5 w-3.5" /> Allocate
          </Button>
        </div>
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
