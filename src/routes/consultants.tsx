import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import {
  actions,
  Consultant,
  LEVELS,
  Level,
  ROLES,
  Role,
  usedCapacity,
  useStore,
} from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, CapacityBar, LevelBadge } from "@/components/consultant-bits";
import { Pencil, Plus, Trash2, UserPlus } from "lucide-react";

export const Route = createFileRoute("/consultants")({
  head: () => ({
    meta: [
      { title: "Consultants — Capacity Board" },
      { name: "description", content: "Manage your team roster: names, levels, and roles." },
      { property: "og:title", content: "Consultants — Capacity Board" },
      { property: "og:description", content: "Manage your team roster." },
    ],
  }),
  component: ConsultantsPage,
});

function ConsultantsPage() {
  const { consultants, demands } = useStore();
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1200px] px-6 pb-10 pt-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Consultants</h1>
            <p className="text-sm text-muted-foreground">
              Your team roster with current utilization.
            </p>
          </div>
          <ConsultantDialog />
        </div>

        <div className="overflow-hidden rounded-2xl border bg-surface">
          <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_180px_100px] gap-4 border-b bg-muted/40 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Name</div>
            <div>Level</div>
            <div>Role</div>
            <div>Utilization</div>
            <div className="text-right">Actions</div>
          </div>
          {consultants.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No consultants yet. Add your first team member.
            </div>
          )}
          {consultants.map((c) => {
            const used = usedCapacity(c.id, demands);
            return (
              <div
                key={c.id}
                className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_180px_100px] items-center gap-4 border-b px-4 py-3 last:border-b-0 hover:bg-muted/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar consultant={c} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {c.name} {c.surname}
                    </p>
                  </div>
                </div>
                <div><LevelBadge level={c.level} /></div>
                <div className="text-sm text-muted-foreground">{c.role}</div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                    <span>{used}% used</span>
                    <span>{Math.max(100 - used, 0)}% free</span>
                  </div>
                  <CapacityBar used={used} />
                </div>
                <div className="flex justify-end gap-1">
                  <ConsultantDialog
                    consultant={c}
                    trigger={
                      <Button size="icon" variant="ghost">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Remove ${c.name} ${c.surname}?`)) actions.removeConsultant(c.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ConsultantDialog({
  consultant,
  trigger,
}: {
  consultant?: Consultant;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(consultant?.name ?? "");
  const [surname, setSurname] = useState(consultant?.surname ?? "");
  const [level, setLevel] = useState<Level>(consultant?.level ?? "Consultant");
  const [role, setRole] = useState<Role>(consultant?.role ?? "Strategy");
  const isEdit = !!consultant;

  const submit = () => {
    if (!name.trim() || !surname.trim()) return;
    if (isEdit) {
      actions.updateConsultant(consultant!.id, { name, surname, level, role });
    } else {
      actions.addConsultant({ name, surname, level, role });
      setName("");
      setSurname("");
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <UserPlus className="h-4 w-4" /> Add consultant
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit consultant" : "Add consultant"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Surname</Label>
              <Input value={surname} onChange={(e) => setSurname(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Level</Label>
              <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>
            {isEdit ? "Save" : <><Plus className="h-4 w-4" /> Add</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
