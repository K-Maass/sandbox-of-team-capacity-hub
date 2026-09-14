import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import {
  LEVELS,
  ROLES,
  usedCapacity,
  type Consultant,
  type Level,
  type Role,
} from "@/lib/types";
import {
  useBoardData,
  useCreateConsultant,
  useDeleteConsultant,
  useUpdateConsultant,
} from "@/lib/data";
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
import { Loader2, Pencil, Plus, Trash2, UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/consultants")({
  head: () => ({
    meta: [
      { title: "Consultants — Capacity Board" },
      { name: "description", content: "Manage your shared team roster: names, levels, roles, skills and capacity." },
      { property: "og:title", content: "Consultants — Capacity Board" },
      { property: "og:description", content: "Manage your shared team roster." },
    ],
  }),
  component: ConsultantsPage,
});

function ConsultantsPage() {
  const { consultants, demands, allocations, isLoading } = useBoardData();
  const deleteConsultant = useDeleteConsultant();

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1200px] px-6 pb-10 pt-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Consultants</h1>
            <p className="text-sm text-muted-foreground">
              Your shared team roster with current utilization.
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
          {isLoading && (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading roster…
            </div>
          )}
          {!isLoading && consultants.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No consultants yet. Add your first team member.
            </div>
          )}
          {consultants.map((c) => {
            const used = usedCapacity(c.id, demands, allocations);
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
                    {c.email && (
                      <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                    )}
                    {c.skills.length > 0 && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {c.skills.join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
                <div><LevelBadge level={c.level} /></div>
                <div className="text-sm text-muted-foreground">{c.role}</div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                    <span>{used}% used</span>
                    <span>{Math.max(c.workingCapacity - used, 0)}% free</span>
                  </div>
                  <CapacityBar used={used} max={c.workingCapacity} />
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
                      if (confirm(`Remove ${c.name} ${c.surname}?`))
                        deleteConsultant.mutate(c.id);
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

export function ConsultantDialog({
  consultant,
  trigger,
}: {
  consultant?: Consultant;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(consultant?.name ?? "");
  const [surname, setSurname] = useState(consultant?.surname ?? "");
  const [email, setEmail] = useState(consultant?.email ?? "");
  const [level, setLevel] = useState<Level>(consultant?.level ?? "Consultant");
  const [role, setRole] = useState<Role>(consultant?.role ?? "Strategy");
  const [skills, setSkills] = useState((consultant?.skills ?? []).join(", "));
  const [workingCapacity, setWorkingCapacity] = useState(
    String(consultant?.workingCapacity ?? 100),
  );
  const [error, setError] = useState<string | null>(null);

  const create = useCreateConsultant();
  const update = useUpdateConsultant();
  const isEdit = !!consultant;
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    if (!name.trim() || !surname.trim()) return;
    setError(null);
    const payload = {
      name,
      surname,
      email: email.trim() || null,
      level,
      role,
      skills: skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      workingCapacity: Math.max(0, Math.min(100, Number(workingCapacity) || 0)),
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: consultant!.id, patch: payload });
      } else {
        await create.mutateAsync(payload);
        setName("");
        setSurname("");
        setEmail("");
        setSkills("");
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
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
          <div className="grid gap-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
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
          <div className="grid gap-1.5">
            <Label>Skills / topics</Label>
            <Input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Pricing, Supply chain, Python"
            />
            <p className="text-xs text-muted-foreground">Separate with commas.</p>
          </div>
          <div className="grid gap-1.5">
            <Label>Working capacity (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={5}
              value={workingCapacity}
              onChange={(e) => setWorkingCapacity(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              100% = full time. Use 60% for a part-time colleague.
            </p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {isEdit ? "Save" : <><Plus className="h-4 w-4" /> Add</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
