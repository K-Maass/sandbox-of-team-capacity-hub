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
import { actions, Consultant, Demand, usedCapacity, useStore } from "@/lib/store";
import { Avatar, CapacityBar, LevelBadge } from "./consultant-bits";

interface Props {
  demandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectConsultantId?: string;
}

export function AllocateDialog({ demandId, open, onOpenChange, preselectConsultantId }: Props) {
  const { consultants, demands } = useStore();
  const demand = demands.find((d) => d.id === demandId);
  const [selectedId, setSelectedId] = useState<string | undefined>(preselectConsultantId);
  const [capacity, setCapacity] = useState(25);

  const selected = consultants.find((c) => c.id === selectedId);
  const currentAlloc = demand?.allocations.find((a) => a.consultantId === selectedId);

  useEffect(() => {
    setSelectedId(preselectConsultantId);
    setCapacity(
      preselectConsultantId
        ? demand?.allocations.find((a) => a.consultantId === preselectConsultantId)?.capacity ??
            25
        : 25,
    );
  }, [preselectConsultantId, demand?.id, open]);

  if (!demand) return null;

  const allocated = (c: Consultant) => usedCapacity(c.id, demands);

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
              const already = demand.allocations.some((a) => a.consultantId === c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedId(c.id);
                    setCapacity(
                      demand.allocations.find((a) => a.consultantId === c.id)?.capacity ?? 25,
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
                      <CapacityBar used={used} />
                      <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
                        {used}%
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
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
                Currently at {allocated(selected)}% across active work.
                {currentAlloc && ` This demand already uses ${currentAlloc.capacity}%.`}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {selected && currentAlloc && (
            <Button
              variant="ghost"
              onClick={() => {
                actions.deallocate(demand.id, selected.id);
                onOpenChange(false);
              }}
            >
              Remove
            </Button>
          )}
          <Button
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              actions.allocate(demand.id, selected.id, capacity);
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
