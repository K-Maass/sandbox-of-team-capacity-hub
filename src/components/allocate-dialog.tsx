import { useEffect, useState } from "react";
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
import { usedCapacity, type Consultant } from "@/lib/types";
import { Avatar, CapacityBar, LevelBadge } from "./consultant-bits";

interface Props {
  demandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectConsultantId?: string;
}

export function AllocateDialog({ demandId, open, onOpenChange, preselectConsultantId }: Props) {
  const { consultants, demands, allocations } = useBoardData();
  const allocate = useAllocate();
  const deallocate = useDeallocate();
  const demand = demands.find((d) => d.id === demandId);
  const demandAllocs = allocations.filter((a) => a.demandId === demandId);
  const [selectedId, setSelectedId] = useState<string | undefined>(preselectConsultantId);
  const [capacity, setCapacity] = useState(25);

  const selected = consultants.find((c) => c.id === selectedId);
  const currentAlloc = demandAllocs.find((a) => a.consultantId === selectedId);

  useEffect(() => {
    setSelectedId(preselectConsultantId);
    setCapacity(
      preselectConsultantId
        ? demandAllocs.find((a) => a.consultantId === preselectConsultantId)?.capacity ?? 25
        : 25,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectConsultantId, demandId, open]);

  if (!demand) return null;

  const allocated = (c: Consultant) => usedCapacity(c.id, demands, allocations);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Allocate to “{demand.title}”</DialogTitle>
          <DialogDescription>
            Pick a consultant and set their allocation percentage.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
            {consultants.map((c) => {
              const used = allocated(c);
              const isSelected = c.id === selectedId;
              const already = demandAllocs.some((a) => a.consultantId === c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedId(c.id);
                    setCapacity(
                      demandAllocs.find((a) => a.consultantId === c.id)?.capacity ?? 25,
                    );
                  }}
                  className={
                    "flex w-full items-center gap-3 rounded-md p-2 text-left transition " +
                    (isSelected ? "bg-secondary" : "hover:bg-secondary/50")
                  }
                >
                  <Avatar consultant={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.name} {c.surname}
                      </span>
                      <LevelBadge level={c.level} />
                      {already && (
                        <span className="rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-medium text-info">
                          allocated
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <CapacityBar used={used} max={c.workingCapacity} />
                      <span className="w-14 text-right text-[11px] tabular-nums text-muted-foreground">
                        {used}/{c.workingCapacity}%
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
            {consultants.length === 0 && (
              <p className="p-4 text-center text-xs text-muted-foreground">
                No consultants yet — add your team first.
              </p>
            )}
          </div>

          {selected && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">
                  Allocate {selected.name} {selected.surname}
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
              <p className="mt-2 text-xs text-muted-foreground">
                Currently at {allocated(selected)}% of {selected.workingCapacity}% across active
                work.
                {currentAlloc && ` This demand already uses ${currentAlloc.capacity}%.`}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {selected && currentAlloc && (
            <Button
              variant="ghost"
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
            {currentAlloc ? "Update" : "Allocate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
