import { useEffect, useMemo, useState } from "react";
import { addDays, addWeeks, format as formatDateFns, startOfWeek } from "date-fns";
import {
  Briefcase,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  UserPlus,
  Users,
} from "lucide-react";
import { AvailabilityDialog } from "@/components/availability-dialog";
import { Avatar, LevelBadge } from "@/components/consultant-bits";
import { DemandDialog } from "@/components/demand-dialog";
import { SkillChips } from "@/components/skill-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  availabilityBlockOnDate,
  demandOverlapsRange,
  demandStatusLabel,
  formatDate,
  formatFte,
  pipelineCapacity,
  staffedCapacity,
  usedCapacity,
  workingCapacityOn,
  type Allocation,
  type AvailabilityBlock,
  type Consultant,
  type Demand,
} from "@/lib/types";

type Scope = "overview" | "people" | "demand";
type Selection = { kind: "consultant" | "demand"; id: string } | null;

type Props = {
  consultants: Consultant[];
  allConsultants: Consultant[];
  demands: Demand[];
  visibleDemands: Demand[];
  allocations: Allocation[];
  availabilityBlocks: AvailabilityBlock[];
  focusDate: string;
  onFocusDateChange: (date: string) => void;
  includePipeline: boolean;
  onAllocateDemand: (demandId: string, consultantId?: string) => void;
  skillSuggestions: string[];
};

function iso(date: Date) {
  return formatDateFns(date, "yyyy-MM-dd");
}

function parseIso(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

export function CapacityTimeline({
  consultants,
  allConsultants,
  demands,
  visibleDemands,
  allocations,
  availabilityBlocks,
  focusDate,
  onFocusDateChange,
  includePipeline,
  onAllocateDemand,
  skillSuggestions,
}: Props) {
  const [scope, setScope] = useState<Scope>("overview");
  const [weekCount, setWeekCount] = useState(8);
  const [windowStart, setWindowStart] = useState(() =>
    startOfWeek(parseIso(focusDate), { weekStartsOn: 1 }),
  );
  const [selection, setSelection] = useState<Selection>(null);

  const weeks = useMemo(
    () =>
      Array.from({ length: weekCount }, (_, index) => {
        const start = addWeeks(windowStart, index);
        const end = addDays(start, 6);
        return { start, end, startIso: iso(start), endIso: iso(end) };
      }),
    [windowStart, weekCount],
  );

  const windowEnd = weeks[weeks.length - 1]?.endIso ?? iso(windowStart);
  const selectedConsultant =
    selection?.kind === "consultant"
      ? allConsultants.find((consultant) => consultant.id === selection.id)
      : undefined;
  const selectedDemand =
    selection?.kind === "demand"
      ? visibleDemands.find((demand) => demand.id === selection.id)
      : undefined;

  useEffect(() => {
    const visibleStart = iso(windowStart);
    const visibleEnd = iso(addDays(addWeeks(windowStart, weekCount), -1));
    if (focusDate < visibleStart || focusDate > visibleEnd) {
      setWindowStart(startOfWeek(parseIso(focusDate), { weekStartsOn: 1 }));
    }
  }, [focusDate, weekCount, windowStart]);

  const shift = (direction: -1 | 1) => {
    const next = addWeeks(windowStart, weekCount * direction);
    setWindowStart(next);
    onFocusDateChange(iso(next));
  };
  const resetToday = () => {
    const today = new Date();
    setWindowStart(startOfWeek(today, { weekStartsOn: 1 }));
    onFocusDateChange(iso(today));
  };

  return (
    <div className="rounded-2xl border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Capacity timeline</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Weekly cells show average weekday capacity. Click a name, project or week to inspect it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border bg-background p-0.5">
            {(["overview", "people", "demand"] as Scope[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setScope(item)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
                  scope === item
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          <Select value={String(weekCount)} onValueChange={(value) => setWeekCount(Number(value))}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4 weeks</SelectItem>
              <SelectItem value="8">8 weeks</SelectItem>
              <SelectItem value="12">12 weeks</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center rounded-lg border bg-background">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => shift(-1)}
              title="Previous window"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={resetToday}>
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => shift(1)}
              title="Next window"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {(selectedConsultant || selectedDemand) && (
        <TimelineSelection
          consultant={selectedConsultant}
          demand={selectedDemand}
          allConsultants={allConsultants}
          demands={demands}
          allocations={allocations}
          availabilityBlocks={availabilityBlocks}
          focusDate={focusDate}
          windowStart={iso(windowStart)}
          windowEnd={windowEnd}
          includePipeline={includePipeline}
          skillSuggestions={skillSuggestions}
          onAllocateDemand={onAllocateDemand}
          onClose={() => setSelection(null)}
        />
      )}

      <div className="overflow-x-auto">
        <div style={{ minWidth: 220 + weekCount * 118 }}>
          <TimelineHeader
            weeks={weeks}
            focusDate={focusDate}
            onFocusDateChange={onFocusDateChange}
          />

          {(scope === "overview" || scope === "people") && (
            <>
              <SectionLabel
                icon={<Users className="h-3.5 w-3.5" />}
                label="People"
                count={consultants.length}
              />
              {consultants.length ? (
                consultants.map((consultant) => (
                  <PersonRow
                    key={consultant.id}
                    consultant={consultant}
                    weeks={weeks}
                    focusDate={focusDate}
                    demands={demands}
                    allocations={allocations}
                    availabilityBlocks={availabilityBlocks}
                    includePipeline={includePipeline}
                    onSelect={() => setSelection({ kind: "consultant", id: consultant.id })}
                    onFocusDateChange={onFocusDateChange}
                  />
                ))
              ) : (
                <TimelineEmpty text="Add team members to see capacity across time." />
              )}
            </>
          )}

          {(scope === "overview" || scope === "demand") && (
            <>
              <SectionLabel
                icon={<Briefcase className="h-3.5 w-3.5" />}
                label="Demand"
                count={visibleDemands.length}
              />
              {visibleDemands.length ? (
                visibleDemands.map((demand) => (
                  <DemandRow
                    key={demand.id}
                    demand={demand}
                    weeks={weeks}
                    focusDate={focusDate}
                    consultants={allConsultants}
                    allocations={allocations}
                    onSelect={() => setSelection({ kind: "demand", id: demand.id })}
                    onFocusDateChange={onFocusDateChange}
                  />
                ))
              ) : (
                <TimelineEmpty text="Create demand to see project coverage across time." />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineHeader({
  weeks,
  focusDate,
  onFocusDateChange,
}: {
  weeks: { start: Date; end: Date; startIso: string; endIso: string }[];
  focusDate: string;
  onFocusDateChange: (date: string) => void;
}) {
  return (
    <div
      className="grid border-b bg-muted/20"
      style={{ gridTemplateColumns: `220px repeat(${weeks.length}, minmax(118px, 1fr))` }}
    >
      <div className="sticky left-0 z-10 flex items-center bg-surface px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Focus · {formatDate(focusDate)}
      </div>
      {weeks.map((week) => {
        const focused = focusDate >= week.startIso && focusDate <= week.endIso;
        return (
          <button
            key={week.startIso}
            type="button"
            onClick={() => onFocusDateChange(week.startIso)}
            className={`border-l px-2 py-2 text-left transition hover:bg-secondary/60 ${focused ? "bg-primary/8" : ""}`}
          >
            <p className="text-[11px] font-semibold">{formatDateFns(week.start, "d MMM")}</p>
            <p className="text-[10px] text-muted-foreground">
              week {formatDateFns(week.start, "I")}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function SectionLabel({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 border-b bg-muted/35 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {icon} {label}
      <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px]">{count}</span>
    </div>
  );
}

function TimelineEmpty({ text }: { text: string }) {
  return <div className="border-b px-4 py-8 text-center text-xs text-muted-foreground">{text}</div>;
}

function personWeekMetrics(
  consultant: Consultant,
  weekStart: Date,
  demands: Demand[],
  allocations: Allocation[],
  blocks: AvailabilityBlock[],
  includePipeline: boolean,
) {
  const weekdays = Array.from({ length: 5 }, (_, index) => iso(addDays(weekStart, index)));
  const working = weekdays.map((date) => workingCapacityOn(consultant, blocks, date));
  const committed = weekdays.map((date) => usedCapacity(consultant.id, demands, allocations, date));
  const pipeline = weekdays.map((date) =>
    pipelineCapacity(consultant.id, demands, allocations, date),
  );
  const confirmedFree = working.map((value, index) => value - committed[index]);
  const plannedFree = confirmedFree.map((value, index) => value - pipeline[index]);
  return {
    working: average(working),
    committed: average(committed),
    pipeline: average(pipeline),
    free: average(includePipeline ? plannedFree : confirmedFree),
    unavailableDays: working.filter((value) => value === 0).length,
  };
}

function availabilityCellClass(free: number, unavailableDays: number) {
  if (unavailableDays === 5) return "bg-muted/60 text-muted-foreground";
  if (free < 0) return "bg-destructive/10 text-destructive";
  if (free <= 20) return "bg-warning/15 text-warning-foreground";
  if (free >= 60) return "bg-success/10 text-success-foreground";
  return "bg-muted/25";
}

function PersonRow({
  consultant,
  weeks,
  focusDate,
  demands,
  allocations,
  availabilityBlocks,
  includePipeline,
  onSelect,
  onFocusDateChange,
}: {
  consultant: Consultant;
  weeks: { start: Date; end: Date; startIso: string; endIso: string }[];
  focusDate: string;
  demands: Demand[];
  allocations: Allocation[];
  availabilityBlocks: AvailabilityBlock[];
  includePipeline: boolean;
  onSelect: () => void;
  onFocusDateChange: (date: string) => void;
}) {
  return (
    <div
      className="grid border-b last:border-b-0"
      style={{ gridTemplateColumns: `220px repeat(${weeks.length}, minmax(118px, 1fr))` }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="sticky left-0 z-10 flex items-center gap-2.5 bg-surface px-4 py-2.5 text-left hover:bg-secondary/40"
      >
        <Avatar consultant={consultant} size={28} />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">
            {consultant.name} {consultant.surname}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {consultant.role} · {consultant.workingCapacity}%
          </p>
        </div>
      </button>
      {weeks.map((week) => {
        const metrics = personWeekMetrics(
          consultant,
          week.start,
          demands,
          allocations,
          availabilityBlocks,
          includePipeline,
        );
        const focused = focusDate >= week.startIso && focusDate <= week.endIso;
        return (
          <button
            key={week.startIso}
            type="button"
            onClick={() => {
              onFocusDateChange(week.startIso);
              onSelect();
            }}
            className={`border-l px-2 py-2 text-left transition hover:brightness-95 ${availabilityCellClass(metrics.free, metrics.unavailableDays)} ${focused ? "ring-1 ring-inset ring-primary/30" : ""}`}
            title={`${consultant.name}: ${metrics.free}% average free capacity this week`}
          >
            <p className="text-xs font-semibold tabular-nums">
              {metrics.unavailableDays === 5 ? "Unavailable" : `${metrics.free}% free`}
            </p>
            <p className="mt-0.5 text-[9px] opacity-75">
              {metrics.committed}% committed
              {metrics.pipeline > 0 ? ` · +${metrics.pipeline}% pipe` : ""}
              {metrics.unavailableDays > 0 && metrics.unavailableDays < 5
                ? ` · ${metrics.unavailableDays}d off`
                : ""}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function DemandRow({
  demand,
  weeks,
  focusDate,
  consultants,
  allocations,
  onSelect,
  onFocusDateChange,
}: {
  demand: Demand;
  weeks: { start: Date; end: Date; startIso: string; endIso: string }[];
  focusDate: string;
  consultants: Consultant[];
  allocations: Allocation[];
  onSelect: () => void;
  onFocusDateChange: (date: string) => void;
}) {
  const staffed = staffedCapacity(demand.id, allocations, consultants);
  const fill = demand.requiredCapacity ? Math.round((staffed / demand.requiredCapacity) * 100) : 0;
  const gap = Math.max(demand.requiredCapacity - staffed, 0);
  const owner = consultants.find((consultant) => consultant.id === demand.ownerConsultantId);
  return (
    <div
      className="grid border-b last:border-b-0"
      style={{ gridTemplateColumns: `220px repeat(${weeks.length}, minmax(118px, 1fr))` }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="sticky left-0 z-10 min-w-0 bg-surface px-4 py-2.5 text-left hover:bg-secondary/40"
      >
        <p className="truncate text-xs font-semibold">{demand.title}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {demandStatusLabel(demand.status)}
          {owner ? ` · ${owner.name}` : ""}
        </p>
      </button>
      {weeks.map((week) => {
        const active = demandOverlapsRange(demand, week.startIso, week.endIso);
        const focused = focusDate >= week.startIso && focusDate <= week.endIso;
        if (!active) {
          return (
            <div
              key={week.startIso}
              className={`border-l bg-muted/5 ${focused ? "ring-1 ring-inset ring-primary/20" : ""}`}
            />
          );
        }
        const pipeline = demand.status === "Incoming";
        return (
          <button
            key={week.startIso}
            type="button"
            onClick={() => {
              const focus =
                demand.startDate &&
                demand.startDate > week.startIso &&
                demand.startDate <= week.endIso
                  ? demand.startDate
                  : week.startIso;
              onFocusDateChange(focus);
              onSelect();
            }}
            className={`border-l px-2 py-2 text-left transition hover:bg-secondary/60 ${
              pipeline
                ? "border-l border-dashed bg-info/5"
                : gap > 0
                  ? "bg-warning/8"
                  : "bg-success/8"
            } ${focused ? "ring-1 ring-inset ring-primary/30" : ""}`}
            title={`${demand.title}: ${fill}% staffed`}
          >
            <p className="text-xs font-semibold tabular-nums">{fill}% filled</p>
            <p className="mt-0.5 text-[9px] text-muted-foreground">
              {gap > 0
                ? `${gap}% needed`
                : gap === 0 && demand.requiredCapacity > 0
                  ? "covered"
                  : `${staffed}% staffed`}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function TimelineSelection({
  consultant,
  demand,
  allConsultants,
  demands,
  allocations,
  availabilityBlocks,
  focusDate,
  windowStart,
  windowEnd,
  includePipeline,
  skillSuggestions,
  onAllocateDemand,
  onClose,
}: {
  consultant?: Consultant;
  demand?: Demand;
  allConsultants: Consultant[];
  demands: Demand[];
  allocations: Allocation[];
  availabilityBlocks: AvailabilityBlock[];
  focusDate: string;
  windowStart: string;
  windowEnd: string;
  includePipeline: boolean;
  skillSuggestions: string[];
  onAllocateDemand: (demandId: string, consultantId?: string) => void;
  onClose: () => void;
}) {
  if (consultant) {
    const working = workingCapacityOn(consultant, availabilityBlocks, focusDate);
    const committed = usedCapacity(consultant.id, demands, allocations, focusDate);
    const pipeline = pipelineCapacity(consultant.id, demands, allocations, focusDate);
    const free = working - committed - (includePipeline ? pipeline : 0);
    const timeOff = availabilityBlockOnDate(consultant.id, availabilityBlocks, focusDate);
    const workInWindow = allocations
      .filter((allocation) => allocation.consultantId === consultant.id)
      .map((allocation) => ({
        allocation,
        demand: demands.find((item) => item.id === allocation.demandId),
      }))
      .filter(
        (item): item is { allocation: Allocation; demand: Demand } =>
          !!item.demand && demandOverlapsRange(item.demand, windowStart, windowEnd),
      );
    const upcomingTimeOff = availabilityBlocks.filter(
      (block) =>
        block.consultantId === consultant.id &&
        block.startDate <= windowEnd &&
        block.endDate >= windowStart,
    );
    return (
      <div className="border-b bg-muted/15 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Avatar consultant={consultant} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">
                  {consultant.name} {consultant.surname}
                </h3>
                <LevelBadge level={consultant.level} />
              </div>
              <p className="text-xs text-muted-foreground">
                {consultant.role} · {consultant.workingCapacity}% normal working capacity
              </p>
              <SkillChips skills={consultant.skills} limit={5} className="mt-1.5" />
            </div>
          </div>
          <div className="flex gap-2">
            <AvailabilityDialog consultant={consultant} blocks={availabilityBlocks} />
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <MiniMetric label="Focus date" value={formatDate(focusDate)} />
          <MiniMetric label="Committed" value={`${committed}%`} />
          <MiniMetric label="Pipeline" value={pipeline ? `+${pipeline}%` : "—"} />
          <MiniMetric
            label={includePipeline ? "Free incl. pipeline" : "Confirmed free"}
            value={timeOff ? "Unavailable" : `${free}%`}
            danger={free < 0 || !!timeOff}
          />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Work in this window
            </p>
            {workInWindow.length ? (
              <div className="space-y-1">
                {workInWindow.map(({ allocation, demand: item }) => (
                  <button
                    key={allocation.id}
                    type="button"
                    onClick={() => onAllocateDemand(item.id, consultant.id)}
                    className="flex w-full items-center justify-between rounded-md bg-background px-2.5 py-2 text-left text-xs hover:bg-secondary/60"
                  >
                    <span className="min-w-0 truncate">
                      {item.title}{" "}
                      <span className="text-muted-foreground">
                        · {demandStatusLabel(item.status)}
                      </span>
                    </span>
                    <span className="ml-2 shrink-0 font-semibold tabular-nums">
                      {allocation.capacity}%
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No allocated work in this window.</p>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Unavailable in this window
            </p>
            {upcomingTimeOff.length ? (
              <div className="space-y-1 text-xs">
                {upcomingTimeOff.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-center gap-2 rounded-md bg-background px-2.5 py-2"
                  >
                    <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>
                      {formatDate(block.startDate)} → {formatDate(block.endDate)}
                    </span>
                    {block.note && (
                      <span className="truncate text-muted-foreground">· {block.note}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No unavailable dates in this window.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (demand) {
    const owner = allConsultants.find((consultant) => consultant.id === demand.ownerConsultantId);
    const demandAllocs = allocations.filter((allocation) => allocation.demandId === demand.id);
    const staffed = staffedCapacity(demand.id, allocations, allConsultants);
    const gap = Math.max(demand.requiredCapacity - staffed, 0);
    return (
      <div className="border-b bg-muted/15 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{demand.title}</h3>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
                {demandStatusLabel(demand.status)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {demand.client || "No client"} · {formatDate(demand.startDate)} →{" "}
              {formatDate(demand.endDate)}
              {owner ? ` · Owner: ${owner.name} ${owner.surname}` : " · No owner"}
            </p>
            <SkillChips skills={demand.skills} limit={6} className="mt-1.5" />
          </div>
          <div className="flex gap-2">
            <DemandDialog
              demand={demand}
              consultants={allConsultants}
              skillSuggestions={skillSuggestions}
              trigger={
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              }
            />
            <Button size="sm" onClick={() => onAllocateDemand(demand.id)}>
              <UserPlus className="h-4 w-4" /> Allocate
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <MiniMetric
            label="Required"
            value={`${demand.requiredCapacity}%`}
            sub={formatFte(demand.requiredCapacity)}
          />
          <MiniMetric label="Staffed" value={`${staffed}%`} />
          <MiniMetric label="Still needed" value={gap ? `${gap}%` : "Covered"} danger={gap > 0} />
          <MiniMetric
            label="People"
            value={String(
              demandAllocs.filter((allocation) =>
                allConsultants.some(
                  (consultant) =>
                    consultant.id === allocation.consultantId && !consultant.archivedAt,
                ),
              ).length,
            )}
          />
        </div>
        {demandAllocs.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {demandAllocs.map((allocation) => {
              const person = allConsultants.find(
                (consultant) => consultant.id === allocation.consultantId,
              );
              if (!person) return null;
              return (
                <button
                  key={allocation.id}
                  type="button"
                  onClick={() => onAllocateDemand(demand.id, person.id)}
                  className="inline-flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs hover:bg-secondary/60"
                >
                  <Avatar consultant={person} size={24} />
                  <span>
                    {person.name} {person.surname}
                  </span>
                  <span className="font-semibold tabular-nums">{allocation.capacity}%</span>
                  {person.archivedAt && <span className="text-muted-foreground">archived</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function MiniMetric({
  label,
  value,
  sub,
  danger = false,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-sm font-semibold tabular-nums ${danger ? "text-destructive" : ""}`}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
