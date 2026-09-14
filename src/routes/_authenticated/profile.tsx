import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import { AppUser } from "@/lib/auth-types";
import { useSession } from "@/lib/auth";
import {
  useBoardData,
  useCreateConsultant,
  useUpdateConsultant,
} from "@/lib/data";
import { LEVELS, ROLES, usedCapacity, type Level, type Role } from "@/lib/types";
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
import { CapacityBar } from "@/components/consultant-bits";
import { CheckCircle2, Link2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "My profile — Capacity Board" },
      { name: "description", content: "Add yourself to the team roster and keep your level, skills and working capacity up to date." },
      { property: "og:title", content: "My profile — Capacity Board" },
      { property: "og:description", content: "Manage your consultant profile." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useSession() as { user: AppUser | null };
  const { consultants, demands, allocations, isLoading } = useBoardData();
  const create = useCreateConsultant();
  const update = useUpdateConsultant();

  const email = user?.email?.toLowerCase() ?? "";
  const mine = consultants.find((c) => user && c.userId === user.id);
  const matchByEmail = !mine
    ? consultants.find((c) => c.email && c.email.toLowerCase() === email && !c.userId)
    : undefined;

  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [level, setLevel] = useState<Level>("Consultant");
  const [role, setRole] = useState<Role>("Strategy");
  const [skills, setSkills] = useState("");
  const [workingCapacity, setWorkingCapacity] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!mine) return;
    setName(mine.name);
    setSurname(mine.surname);
    setLevel(mine.level);
    setRole(mine.role);
    setSkills(mine.skills.join(", "));
    setWorkingCapacity(String(mine.workingCapacity));
  }, [mine?.id]);

  const busy = create.isPending || update.isPending;
  const used = mine ? usedCapacity(mine.id, demands, allocations) : 0;

  const save = async () => {
    if (!name.trim() || !surname.trim() || !user) return;
    setError(null);
    setSaved(false);
    const payload = {
      name,
      surname,
      email,
      level,
      role,
      skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      workingCapacity: Math.max(0, Math.min(100, Number(workingCapacity) || 0)),
    };
    try {
      if (mine) {
        await update.mutateAsync({ id: mine.id, patch: payload });
      } else {
        await create.mutateAsync({ ...payload, userId: user.id });
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };

  const linkExisting = async () => {
    if (!matchByEmail || !user) return;
    setError(null);
    try {
      await update.mutateAsync({ id: matchByEmail.id, patch: { userId: user.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[720px] px-6 pb-10 pt-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
          <p className="text-sm text-muted-foreground">
            {mine
              ? "You're on the roster. Keep your details current."
              : "Add yourself to the team roster so you can be staffed."}
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border bg-surface p-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid gap-4">
            {matchByEmail && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-info/40 bg-info/10 p-4">
                <div>
                  <p className="text-sm font-medium">
                    Found {matchByEmail.name} {matchByEmail.surname} on the roster
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Same email as your account — link it instead of creating a duplicate.
                  </p>
                </div>
                <Button size="sm" onClick={linkExisting} disabled={busy}>
                  <Link2 className="h-4 w-4" /> That's me
                </Button>
              </div>
            )}

            {mine && (
              <div className="rounded-2xl border bg-surface p-4">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Your current allocation</span>
                  <span className="tabular-nums">
                    {used}% of {mine.workingCapacity}%
                  </span>
                </div>
                <CapacityBar used={used} max={mine.workingCapacity} />
              </div>
            )}

            <div className="grid gap-3 rounded-2xl border bg-surface p-5">
              <div className="grid gap-1.5">
                <Label>Account email</Label>
                <Input value={email} readOnly disabled />
              </div>
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
              <div className="grid gap-1.5">
                <Label>Skills / topics</Label>
                <Input
                  value={skills}
                  onChange={(e) => setSkills(e.target.value)}
                  placeholder="Pricing, Supply chain, Python"
                />
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
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="mt-1 flex items-center gap-3">
                <Button onClick={save} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {mine ? "Save changes" : "Add me to the roster"}
                </Button>
                {saved && (
                  <span className="inline-flex items-center gap-1 text-xs text-success-foreground">
                    <CheckCircle2 className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
