import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import { AvailabilityDialog } from "@/components/availability-dialog";
import { DataError } from "@/components/data-error";
import { useSession } from "@/lib/auth";
import { useBoardData, useCreateConsultant, useUpdateConsultant } from "@/lib/data";
import {
  LEVELS,
  ROLES,
  availabilityBlockOnDate,
  formatDate,
  pipelineCapacity,
  todayIsoDate,
  usedCapacity,
  workingCapacityOn,
  type Level,
  type Role,
} from "@/lib/types";
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
import { SkillInput } from "@/components/skill-input";
import { ArchiveRestore, CalendarOff, CheckCircle2, Link2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "My profile — Capacity Board" },
      {
        name: "description",
        content:
          "Add yourself to the team roster and keep your level, skills and working capacity up to date.",
      },
      { property: "og:title", content: "My profile — Capacity Board" },
      { property: "og:description", content: "Manage your consultant profile." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useSession();
  const {
    consultants,
    demands,
    allocations,
    availabilityBlocks,
    isLoading,
    error: dataError,
  } = useBoardData();
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
  const [skills, setSkills] = useState<string[]>([]);
  const [workingCapacity, setWorkingCapacity] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const hydratedConsultantId = useRef<string | null>(null);

  useEffect(() => {
    if (!mine || hydratedConsultantId.current === mine.id) return;
    hydratedConsultantId.current = mine.id;
    setName(mine.name);
    setSurname(mine.surname);
    setLevel(mine.level);
    setRole(mine.role);
    setSkills(mine.skills);
    setWorkingCapacity(String(mine.workingCapacity));
  }, [mine]);

  const busy = create.isPending || update.isPending;
  const skillSuggestions = Array.from(
    new Set([
      ...consultants.flatMap((consultant) => consultant.skills),
      ...demands.flatMap((demand) => demand.skills),
    ]),
  );
  const capacityDate = todayIsoDate();
  const used = mine ? usedCapacity(mine.id, demands, allocations, capacityDate) : 0;
  const pipeline = mine ? pipelineCapacity(mine.id, demands, allocations, capacityDate) : 0;
  const working = mine ? workingCapacityOn(mine, availabilityBlocks, capacityDate) : 0;
  const unavailableToday = mine
    ? availabilityBlockOnDate(mine.id, availabilityBlocks, capacityDate)
    : undefined;
  const myAvailability = mine
    ? availabilityBlocks
        .filter((block) => block.consultantId === mine.id && block.endDate >= capacityDate)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
    : [];

  const save = async () => {
    if (!user) return;
    if (!name.trim() || !surname.trim()) {
      setError("Name and surname are required.");
      return;
    }
    const parsedCapacity = Number(workingCapacity);
    if (!Number.isFinite(parsedCapacity) || parsedCapacity < 0 || parsedCapacity > 100) {
      setError("Working capacity must be between 0% and 100%.");
      return;
    }
    setError(null);
    setSaved(false);
    const payload = {
      name,
      surname,
      email,
      level,
      role,
      skills,
      workingCapacity: parsedCapacity,
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
      await update.mutateAsync({
        id: matchByEmail.id,
        patch: { userId: user.id, archivedAt: null },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[720px] px-6 pb-10 pt-6">
        <DataError error={dataError} />
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            {mine ? "My profile" : "Join the team"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mine
              ? "Keep your details current so staffing decisions stay accurate."
              : "This takes about 30 seconds. Add the details your team needs to understand your availability."}
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

            {mine?.archivedAt && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
                <div>
                  <p className="text-sm font-medium">Your profile is archived</p>
                  <p className="text-xs text-muted-foreground">
                    You are not currently counted in team capacity or live staffing.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => update.mutate({ id: mine.id, patch: { archivedAt: null } })}
                  disabled={update.isPending}
                >
                  <ArchiveRestore className="h-4 w-4" /> Rejoin active team
                </Button>
              </div>
            )}

            {mine && !mine.archivedAt && (
              <div className="rounded-2xl border bg-surface p-4">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Your availability today ({formatDate(capacityDate)})</span>
                  <span className="tabular-nums">
                    {unavailableToday
                      ? "Unavailable"
                      : `${used}% committed${pipeline > 0 ? ` · +${pipeline}% pipeline` : ""}`}
                  </span>
                </div>
                <CapacityBar used={used} max={Math.max(working, 1)} />
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEVELS.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Skills / topics</Label>
                <SkillInput
                  value={skills}
                  onChange={setSkills}
                  suggestions={skillSuggestions}
                  placeholder="e.g. AI, Automation, Supply chain"
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
                  {mine ? "Save changes" : "Join team"}
                </Button>
                {saved && (
                  <span className="inline-flex items-center gap-1 text-xs text-success-foreground">
                    <CheckCircle2 className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>
            </div>

            {mine && !mine.archivedAt && (
              <div className="rounded-2xl border bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <CalendarOff className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-semibold">Unavailable dates</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Add vacation, training or other full days when you should not appear as
                      staffable.
                    </p>
                  </div>
                  <AvailabilityDialog consultant={mine} blocks={availabilityBlocks} />
                </div>
                {myAvailability.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {myAvailability.slice(0, 3).map((block) => (
                      <div
                        key={block.id}
                        className="flex items-center justify-between gap-3 rounded-lg bg-muted/35 px-3 py-2 text-xs"
                      >
                        <span>
                          {formatDate(block.startDate)} → {formatDate(block.endDate)}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {block.note || "Unavailable"}
                        </span>
                      </div>
                    ))}
                    {myAvailability.length > 3 && (
                      <p className="text-[11px] text-muted-foreground">
                        +{myAvailability.length - 3} more period
                        {myAvailability.length - 3 === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No upcoming unavailable dates.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
