import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import { AvailabilityDialog } from "@/components/availability-dialog";
import { DataError } from "@/components/data-error";
import {
  LEVELS,
  ROLES,
  availabilityBlockOnDate,
  pipelineCapacity,
  todayIsoDate,
  usedCapacity,
  workingCapacityOn,
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
import { SkillChips, SkillInput } from "@/components/skill-input";
import {
  Archive,
  ArchiveRestore,
  CalendarOff,
  Check,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/consultants")({
  head: () => ({
    meta: [
      { title: "Team — Capacity Board" },
      { name: "description", content: "Your shared team roster, skills and capacity." },
      { property: "og:title", content: "Team — Capacity Board" },
      { property: "og:description", content: "Understand and manage your shared team roster." },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  const { consultants, demands, allocations, availabilityBlocks, isLoading, error } =
    useBoardData();
  const deleteConsultant = useDeleteConsultant();
  const updateConsultant = useUpdateConsultant();
  const capacityDate = todayIsoDate();
  const [copied, setCopied] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const activeConsultants = consultants.filter((consultant) => !consultant.archivedAt);
  const archivedConsultants = consultants.filter((consultant) => !!consultant.archivedAt);
  const visibleConsultants = showArchived ? archivedConsultants : activeConsultants;
  const skillSuggestions = Array.from(
    new Set(consultants.flatMap((consultant) => consultant.skills)),
  );

  const copyTeamLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this team link", window.location.origin);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1200px] px-6 pb-10 pt-6">
        <DataError error={error} />
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
            <p className="text-sm text-muted-foreground">
              See skills, availability and time off at a glance. Archive people instead of deleting
              history.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border bg-surface p-0.5">
              <button
                type="button"
                onClick={() => setShowArchived(false)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  !showArchived ? "bg-secondary text-foreground" : "text-muted-foreground"
                }`}
              >
                Active {activeConsultants.length}
              </button>
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  showArchived ? "bg-secondary text-foreground" : "text-muted-foreground"
                }`}
              >
                Archived {archivedConsultants.length}
              </button>
            </div>
            <Button variant="outline" onClick={copyTeamLink}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Link copied" : "Copy team link"}
            </Button>
            {!showArchived && <ConsultantDialog skillSuggestions={skillSuggestions} />}
          </div>
        </div>

        {!showArchived && (
          <div className="mb-4 rounded-xl border bg-surface px-4 py-3">
            <p className="text-sm font-medium">Share with the team</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Anyone with the app link can create an account and add themselves. Use “Add manually”
              only when you want to pre-create someone.
            </p>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border bg-surface">
          <div className="grid min-w-[980px] grid-cols-[minmax(0,2fr)_1.2fr_1.7fr_210px_140px] gap-4 border-b bg-muted/40 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Name</div>
            <div>Role</div>
            <div>Skills</div>
            <div>Capacity today</div>
            <div className="text-right">Actions</div>
          </div>
          {isLoading && (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
            </div>
          )}
          {!isLoading && visibleConsultants.length === 0 && (
            <div className="flex flex-col items-center justify-center p-10 text-center">
              <p className="text-sm font-medium">
                {showArchived ? "No archived team members" : "No one is on the team yet"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                {showArchived
                  ? "Archived people stay here when someone leaves the active roster."
                  : "Share the app link so colleagues can add themselves, or create the first profile manually."}
              </p>
              {!showArchived && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyTeamLink}>
                    <Copy className="h-4 w-4" /> Copy team link
                  </Button>
                  <ConsultantDialog
                    skillSuggestions={skillSuggestions}
                    trigger={
                      <Button size="sm">
                        <UserPlus className="h-4 w-4" /> Add manually
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          )}
          {visibleConsultants.map((consultant) => {
            const used = usedCapacity(consultant.id, demands, allocations, capacityDate);
            const pipeline = pipelineCapacity(consultant.id, demands, allocations, capacityDate);
            const working = workingCapacityOn(consultant, availabilityBlocks, capacityDate);
            const unavailable = availabilityBlockOnDate(
              consultant.id,
              availabilityBlocks,
              capacityDate,
            );
            const free = working - used;
            return (
              <div
                key={consultant.id}
                className="grid min-w-[980px] grid-cols-[minmax(0,2fr)_1.2fr_1.7fr_210px_140px] items-center gap-4 border-b px-4 py-3 last:border-b-0 hover:bg-muted/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar consultant={consultant} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">
                        {consultant.name} {consultant.surname}
                      </p>
                      {consultant.archivedAt && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          Archived
                        </span>
                      )}
                    </div>
                    {consultant.email && (
                      <p className="truncate text-xs text-muted-foreground">{consultant.email}</p>
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{consultant.role}</span>
                    <LevelBadge level={consultant.level} />
                  </div>
                </div>
                <div>
                  {consultant.skills.length ? (
                    <SkillChips skills={consultant.skills} limit={5} />
                  ) : (
                    <span className="text-xs text-muted-foreground">No skills added</span>
                  )}
                </div>
                <div>
                  {consultant.archivedAt ? (
                    <p className="text-xs text-muted-foreground">Not included in live capacity</p>
                  ) : unavailable ? (
                    <div className="rounded-lg bg-muted/50 px-2.5 py-2">
                      <p className="text-xs font-medium text-muted-foreground">Unavailable today</p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {unavailable.note || "Unavailable period"}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="mb-1 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                        <span>{used}% committed</span>
                        <span className={free < 0 ? "text-destructive" : ""}>
                          {free >= 0 ? `${free}% free` : `${Math.abs(free)}% over`}
                        </span>
                      </div>
                      <CapacityBar used={used} max={consultant.workingCapacity} />
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {consultant.workingCapacity}% working capacity
                        {pipeline > 0 ? ` · +${pipeline}% pipeline` : ""}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex justify-end gap-1">
                  {!consultant.archivedAt && (
                    <AvailabilityDialog
                      consultant={consultant}
                      blocks={availabilityBlocks}
                      trigger={
                        <Button size="icon" variant="ghost" title="Unavailable dates">
                          <CalendarOff className="h-4 w-4" />
                        </Button>
                      }
                    />
                  )}
                  <ConsultantDialog
                    consultant={consultant}
                    skillSuggestions={skillSuggestions}
                    trigger={
                      <Button size="icon" variant="ghost" title="Edit team member">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  {consultant.archivedAt ? (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Restore to active team"
                        onClick={() =>
                          updateConsultant.mutate({
                            id: consultant.id,
                            patch: { archivedAt: null },
                          })
                        }
                      >
                        <ArchiveRestore className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Delete permanently"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (
                            confirm(
                              `Permanently delete ${consultant.name} ${consultant.surname} and their allocation history?`,
                            )
                          ) {
                            deleteConsultant.mutate(consultant.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Archive team member"
                      onClick={() => {
                        if (
                          confirm(
                            `Archive ${consultant.name} ${consultant.surname}? Their history will be kept, but they will stop counting toward live capacity and staffing.`,
                          )
                        ) {
                          updateConsultant.mutate({
                            id: consultant.id,
                            patch: { archivedAt: new Date().toISOString() },
                          });
                        }
                      }}
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
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
  skillSuggestions = [],
}: {
  consultant?: Consultant;
  trigger?: React.ReactNode;
  skillSuggestions?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(consultant?.name ?? "");
  const [surname, setSurname] = useState(consultant?.surname ?? "");
  const [email, setEmail] = useState(consultant?.email ?? "");
  const [level, setLevel] = useState<Level>(consultant?.level ?? "Consultant");
  const [role, setRole] = useState<Role>(consultant?.role ?? "Strategy");
  const [skills, setSkills] = useState<string[]>(consultant?.skills ?? []);
  const [workingCapacity, setWorkingCapacity] = useState(
    String(consultant?.workingCapacity ?? 100),
  );
  const [error, setError] = useState<string | null>(null);

  const create = useCreateConsultant();
  const update = useUpdateConsultant();
  const isEdit = !!consultant;
  const busy = create.isPending || update.isPending;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setName(consultant?.name ?? "");
      setSurname(consultant?.surname ?? "");
      setEmail(consultant?.email ?? "");
      setLevel(consultant?.level ?? "Consultant");
      setRole(consultant?.role ?? "Strategy");
      setSkills(consultant?.skills ?? []);
      setWorkingCapacity(String(consultant?.workingCapacity ?? 100));
      setError(null);
    }
    setOpen(nextOpen);
  };

  const submit = async () => {
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
    const payload = {
      name,
      surname,
      email: email.trim() || null,
      level,
      role,
      skills,
      workingCapacity: parsedCapacity,
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: consultant!.id, patch: payload });
      } else {
        await create.mutateAsync(payload);
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
          <Button>
            <UserPlus className="h-4 w-4" /> Add manually
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit team member" : "Add team member manually"}</DialogTitle>
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
              placeholder="Optional — lets them claim this profile"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Level</Label>
              <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
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
                  {ROLES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Skills / topics</Label>
            <SkillInput value={skills} onChange={setSkills} suggestions={skillSuggestions} />
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
              100% is full time; use 60% for a three-day equivalent.
            </p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {isEdit ? (
              "Save"
            ) : (
              <>
                <Plus className="h-4 w-4" /> Add
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
