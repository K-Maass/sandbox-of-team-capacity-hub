import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEMAND_STATUSES,
  DEMAND_STATUS_META,
  DEMAND_TYPES,
  formatFte,
  type Demand,
  type DemandStatus,
  type DemandType,
} from "@/lib/types";
import { useCreateDemand, useUpdateDemand } from "@/lib/data";
import { SkillInput } from "@/components/skill-input";
import { ChevronDown, Plus } from "lucide-react";

interface Props {
  demand?: Demand;
  trigger?: React.ReactNode;
  skillSuggestions?: string[];
}

export function DemandDialog({ demand, trigger, skillSuggestions = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(demand?.title ?? "");
  const [client, setClient] = useState(demand?.client ?? "");
  const [type, setType] = useState<DemandType>(demand?.type ?? "Project");
  const [status, setStatus] = useState<DemandStatus>(demand?.status ?? "Incoming");
  const [description, setDescription] = useState(demand?.description ?? "");
  const [skills, setSkills] = useState<string[]>(demand?.skills ?? []);
  const [startDate, setStartDate] = useState(demand?.startDate ?? "");
  const [endDate, setEndDate] = useState(demand?.endDate ?? "");
  const [requiredCapacity, setRequiredCapacity] = useState(String(demand?.requiredCapacity ?? 100));
  const [error, setError] = useState<string | null>(null);

  const createDemand = useCreateDemand();
  const updateDemand = useUpdateDemand();
  const isEdit = !!demand;
  const busy = createDemand.isPending || updateDemand.isPending;
  const parsedCapacity = Math.max(0, Math.min(1000, Number(requiredCapacity) || 0));

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setTitle(demand?.title ?? "");
      setClient(demand?.client ?? "");
      setType(demand?.type ?? "Project");
      setStatus(demand?.status ?? "Incoming");
      setDescription(demand?.description ?? "");
      setSkills(demand?.skills ?? []);
      setStartDate(demand?.startDate ?? "");
      setEndDate(demand?.endDate ?? "");
      setRequiredCapacity(String(demand?.requiredCapacity ?? 100));
      setError(null);
    }
    setOpen(nextOpen);
  };

  const submit = async () => {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      setError("End date cannot be before start date.");
      return;
    }
    setError(null);
    const payload = {
      title,
      client,
      type,
      status,
      description,
      skills,
      startDate: startDate || null,
      endDate: endDate || null,
      requiredCapacity: parsedCapacity,
    };
    try {
      if (isEdit) {
        await updateDemand.mutateAsync({ id: demand!.id, patch: payload });
      } else {
        await createDemand.mutateAsync(payload);
        setTitle("");
        setClient("");
        setDescription("");
        setSkills([]);
        setStartDate("");
        setEndDate("");
        setRequiredCapacity("100");
        setType("Project");
        setStatus("Incoming");
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="h-4 w-4" /> New demand
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit demand" : "Add demand"}</DialogTitle>
          <DialogDescription>
            Capture what needs staffing. You can add the finer details only when they matter.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Retail pricing overhaul"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Client / owner</Label>
            <Input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Client or internal owner"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Start</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>End</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Required effort (%)</Label>
            <Input
              type="number"
              min={0}
              max={1000}
              step={5}
              value={requiredCapacity}
              onChange={(e) => setRequiredCapacity(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {parsedCapacity}% = {formatFte(parsedCapacity)}. 100% is one full-time person.
            </p>
          </div>

          <details className="group rounded-xl border bg-muted/20" open={isEdit || undefined}>
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium">
              More details
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 border-t px-3 pb-3 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as DemandType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEMAND_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as DemandStatus)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEMAND_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {DEMAND_STATUS_META[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {DEMAND_STATUS_META[status].description}
                  </p>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Skills / topics</Label>
                <SkillInput
                  value={skills}
                  onChange={setSkills}
                  suggestions={skillSuggestions}
                  placeholder="e.g. AI, Supply chain, Pricing"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Notes</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          </details>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
