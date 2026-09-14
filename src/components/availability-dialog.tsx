import { useMemo, useState } from "react";
import { CalendarOff, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateAvailabilityBlock, useDeleteAvailabilityBlock } from "@/lib/data";
import { formatDate, todayIsoDate, type AvailabilityBlock, type Consultant } from "@/lib/types";

export function AvailabilityDialog({
  consultant,
  blocks,
  trigger,
}: {
  consultant: Consultant;
  blocks: AvailabilityBlock[];
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateAvailabilityBlock();
  const remove = useDeleteAvailabilityBlock();
  const today = todayIsoDate();

  const mine = useMemo(
    () =>
      blocks
        .filter((block) => block.consultantId === consultant.id)
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [blocks, consultant.id],
  );
  const upcoming = mine.filter((block) => block.endDate >= today);
  const past = mine.filter((block) => block.endDate < today).reverse();

  const add = async () => {
    if (!startDate || !endDate) {
      setError("Choose a start and end date.");
      return;
    }
    if (endDate < startDate) {
      setError("End date cannot be before start date.");
      return;
    }
    const overlaps = mine.some((block) => block.startDate <= endDate && block.endDate >= startDate);
    if (overlaps) {
      setError("This overlaps an existing unavailable period.");
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({ consultantId: consultant.id, startDate, endDate, note });
      setNote("");
      setStartDate(todayIsoDate());
      setEndDate(todayIsoDate());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save unavailable dates.");
    }
  };

  const BlockRow = ({ block }: { block: AvailabilityBlock }) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {formatDate(block.startDate)} → {formatDate(block.endDate)}
        </p>
        <p className="truncate text-xs text-muted-foreground">{block.note || "Unavailable"}</p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
        title="Remove unavailable period"
        disabled={remove.isPending}
        onClick={() => remove.mutate(block.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <CalendarOff className="h-4 w-4" /> Unavailable dates
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{consultant.name} · unavailable dates</DialogTitle>
          <DialogDescription>
            Add full days when this person should have no staffable capacity. No approval workflow —
            this simply keeps planning accurate.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>From</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    const next = event.target.value;
                    setStartDate(next);
                    if (endDate < next) setEndDate(next);
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>To</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="mt-3 grid gap-1.5">
              <Label>
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Vacation, conference, training…"
              />
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            <Button className="mt-3" size="sm" onClick={add} disabled={create.isPending}>
              {create.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add period
            </Button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Upcoming & current</p>
              <span className="text-xs text-muted-foreground">{upcoming.length}</span>
            </div>
            {upcoming.length ? (
              <div className="space-y-2">
                {upcoming.map((block) => (
                  <BlockRow key={block.id} block={block} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
                No unavailable dates recorded.
              </div>
            )}
          </div>

          {past.length > 0 && (
            <details className="rounded-lg border px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Past periods ({past.length})
              </summary>
              <div className="mt-2 space-y-2">
                {past.map((block) => (
                  <BlockRow key={block.id} block={block} />
                ))}
              </div>
            </details>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
