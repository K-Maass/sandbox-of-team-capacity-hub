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
  actions,
  DEMAND_STATUSES,
  DEMAND_TYPES,
  Demand,
  DemandStatus,
  DemandType,
} from "@/lib/store";
import { Plus } from "lucide-react";

interface Props {
  demand?: Demand;
  trigger?: React.ReactNode;
}

export function DemandDialog({ demand, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(demand?.title ?? "");
  const [client, setClient] = useState(demand?.client ?? "");
  const [type, setType] = useState<DemandType>(demand?.type ?? "Project");
  const [status, setStatus] = useState<DemandStatus>(demand?.status ?? "Incoming");
  const [description, setDescription] = useState(demand?.description ?? "");
  const [startDate, setStartDate] = useState(demand?.startDate ?? "");
  const [endDate, setEndDate] = useState(demand?.endDate ?? "");

  const isEdit = !!demand;

  const submit = () => {
    if (!title.trim()) return;
    if (isEdit) {
      actions.updateDemand(demand!.id, {
        title,
        client,
        type,
        status,
        description,
        startDate,
        endDate,
      });
    } else {
      actions.addDemand({ title, client, type, status, description, startDate, endDate });
    }
    setOpen(false);
    if (!isEdit) {
      setTitle("");
      setClient("");
      setDescription("");
      setStartDate("");
      setEndDate("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="h-4 w-4" /> New demand
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit demand" : "Add a demand"}</DialogTitle>
          <DialogDescription>
            Projects, topics, or RfPs that need staffing.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Retail pricing overhaul" />
          </div>
          <div className="grid gap-1.5">
            <Label>Client</Label>
            <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client or internal owner" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as DemandType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEMAND_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as DemandStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEMAND_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
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
            <Label>Notes</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>{isEdit ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
