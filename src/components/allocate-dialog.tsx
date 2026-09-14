import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useAllocate, useBoardData, useDeallocate } from "@/lib/data";
import {
  availabilityBlockOnDate,
  demandOverlapsDate,
  formatDate,
  pipelineCapacity,
  skillMatchCount,
  todayIsoDate,
  usedCapacity,
  workingCapacityOn,
  type Consultant,
} from "@/lib/types";
import { Avatar, CapacityBar, LevelBadge } from "./consultant-bits";
import { SkillChips } from "./skill-input";

interface Props {
  demandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectConsultantId?: string;
  asOfDate?: string;
}

export function AllocateDialog({
  demandId,
  open,
  onOpenChange,
  preselectConsultantId,
  asOfDate,
}: Props) {
  const { consultants, demands, allocations, availabilityBlocks } = useBoardData();
  const allocate = useAllocate();
  const deallocate = useDeallocate();
  const demand = demands.find((d) => d.id === demandId);
  const demandAllocs = allocations.filter((a) => a.demandId === demandId);
  const preselectedCapacity = preselectConsultantId
    ? (demandAllocs.find((a) => a.consultantId === preselectConsultantId)?.capacity ?? 25)
    : 25;
  const [selectedId, setSelectedId] = useState<string | undefined>(preselectConsultantId);
  const [capacity, setCapacity] = useState(preselectedCapacity);

  const selected = consultants.find((c) => c.id === selectedId);
  const currentAlloc = demandAllocs.find((a) => a.consultantId === selectedId);
  const referenceDate =
    demand && asOfDate && demandOverlapsDate(demand, asOfDate)
      ? asOfDate
      : demand?.startDate || asOfDate || todayIsoDate();

  const rankedConsultants = useMemo(() => {
    const activeConsultants = consultants.filter((consultant) => !consultant.archivedAt);
    if (!demand) return activeConsultants;
    return [...activeConsultants].sort((a, b) => {
      const matchDifference =
        skillMatchCount(b.skills, demand.skills) - skillMatchCount(a.skills, demand.skills);
      if (matchDifference) return matchDifference;
      const aFree =
        workingCapacityOn(a, availabilityBlocks, referenceDate) -
        usedCapacity(a.id, demands, allocations, referenceDate, demand.id);
      const bFree =
        workingCapacityOn(b, availabilityBlocks, referenceDate) -
        usedCapacity(b.id, demands, allocations, referenceDate, demand.id);
      return bFree - aFree;
    });
  }, [consultants, demand, demands, allocations, availabilityBlocks, referenceDate]);

  if (!demand) return null;

  const baseLoad = (c: Consultant) =>
    usedCapacity(c.id, demands, allocations, referenceDate, demand.id);
  const basePipeline = (c: Consultant) =>
    pipelineCapacity(c.id, demands, allocations, referenceDate, demand.id);

  const selectedBaseLoad = selected ? baseLoad(selected) : 0;
  const selectedPipeline = selected ? basePipeline(selected) : 0;
  const selectedWorkingCapacity = selected
    ? workingCapacityOn(selected, availabilityBlocks, referenceDate)
    : 0;
  const isPipeline = demand.status === "Incoming";
  const availableBefore = selected ? selectedWorkingCapacity - selectedBaseLoad : 0;
  const plannedBefore = selected ? availableBefore - selectedPipeline : 0;
  const remaining = selected
    ? isPipeline
      ? plannedBefore - capacity
      : availableBefore - capacity
    : 0;
  const projectedOver = selected ? remaining < 0 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Allocate to “{demand.title}”</DialogTitle>
          <DialogDescription>
            Choose a person and allocation for {formatDate(referenceDate)}. Best skill matches and
            availability appear first.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {demand.skills.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Looking for:</span>
              <SkillChips skills={demand.skills} />
            </div>
          )}

          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
            {rankedConsultants.map((c) => {
              const loadWithoutDemand = baseLoad(c);
              const pipelineWithoutDemand = basePipeline(c);
              const working = workingCapacityOn(c, availabilityBlocks, referenceDate);
              const available = working - loadWithoutDemand;
              const unavailable = !!availabilityBlockOnDate(
                c.id,
                availabilityBlocks,
                referenceDate,
              );
              const isSelected = c.id === selectedId;
              const already = demandAllocs.some((a) => a.consultantId === c.id);
              const matches = skillMatchCount(c.skills, demand.skills);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(c.id);
                    setCapacity(demandAllocs.find((a) => a.consultantId === c.id)?.capacity ?? 25);
                  }}
                  className={
                    "flex w-full items-center gap-3 rounded-md p-2 text-left transition " +
                    (isSelected ? "bg-secondary" : "hover:bg-secondary/50")
                  }
                >
                  <Avatar consultant={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.name} {c.surname}
                      </span>
                      <LevelBadge level={c.level} />
                      {matches > 0 && (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success-foreground">
                          {matches} skill {matches === 1 ? "match" : "matches"}
                        </span>
                      )}
                      {already && (
                        <span className="rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-medium text-info">
                          allocated
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <CapacityBar used={loadWithoutDemand} max={Math.max(working, 1)} />
                      <span
                        className={`w-28 text-right text-[11px] tabular-nums ${
                          available < 0 || unavailable
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {unavailable ? "Unavailable" : `${available}% available`}
                        {pipelineWithoutDemand > 0 && !unavailable
                          ? ` · +${pipelineWithoutDemand}% pipe`
                          : ""}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
            {consultants.length === 0 && (
              <p className="p-4 text-center text-xs text-muted-foreground">
                No team members yet — add your team first.
              </p>
            )}
          </div>

          {selected && (
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  {selected.name} {selected.surname}
                </span>
                <span className="text-sm font-semibold tabular-nums">{capacity}%</span>
              </div>
              <Slider
                value={[capacity]}
                onValueChange={([v]) => setCapacity(v)}
                min={5}
                max={100}
                step={5}
              />
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <CapacityFigure
                  label={isPipeline ? "Confirmed free" : "Available"}
                  value={`${availableBefore}%`}
                />
                <CapacityFigure
                  label={isPipeline ? "This pipeline" : "This allocation"}
                  value={`${capacity}%`}
                />
                <CapacityFigure
                  label={isPipeline ? "Free if won" : "Remaining"}
                  value={`${remaining}%`}
                  destructive={projectedOver}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Existing committed work: {selectedBaseLoad}% of {selectedWorkingCapacity}% available
                working capacity
                {selectedPipeline > 0 ? `, plus ${selectedPipeline}% other pipeline` : ""}.
              </p>
              {projectedOver && (
                <p className="mt-2 text-xs font-medium text-destructive">
                  {isPipeline ? "If this pipeline work is confirmed, " : "This would put "}
                  {selected.name} {Math.abs(remaining)}% over capacity. You can still save it if
                  that is intentional.
                </p>
              )}
              {currentAlloc && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This demand currently uses {currentAlloc.capacity}% for this person.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {selected && currentAlloc && (
            <Button
              variant="ghost"
              disabled={deallocate.isPending}
              onClick={async () => {
                await deallocate.mutateAsync({ demandId, consultantId: selected.id });
                onOpenChange(false);
              }}
            >
              Remove
            </Button>
          )}
          <Button
            disabled={!selected || allocate.isPending}
            onClick={async () => {
              if (!selected) return;
              await allocate.mutateAsync({ demandId, consultantId: selected.id, capacity });
              onOpenChange(false);
            }}
          >
            {currentAlloc ? "Update allocation" : "Confirm allocation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CapacityFigure({
  label,
  value,
  destructive = false,
}: {
  label: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <div className="rounded-lg bg-background px-2 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums ${destructive ? "text-destructive" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
