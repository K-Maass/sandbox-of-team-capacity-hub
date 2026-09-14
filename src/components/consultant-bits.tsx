import type { Consultant, Level } from "@/lib/types";

const levelColor: Record<Level, string> = {
  Junior: "bg-info/15 text-info",
  Consultant: "bg-accent/20 text-accent-foreground",
  Senior: "bg-success/20 text-success-foreground",
  Manager: "bg-warning/25 text-warning-foreground",
  Partner: "bg-primary/15 text-primary",
};

export function initials(c: Pick<Consultant, "name" | "surname">) {
  return (c.name[0] ?? "") + (c.surname[0] ?? "");
}

const palette = [
  "oklch(0.72 0.15 165)",
  "oklch(0.68 0.12 240)",
  "oklch(0.78 0.15 75)",
  "oklch(0.65 0.18 20)",
  "oklch(0.6 0.15 300)",
  "oklch(0.7 0.14 130)",
];

export function avatarColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function Avatar({ consultant, size = 36 }: { consultant: Consultant; size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full font-semibold text-primary-foreground"
      style={{
        width: size,
        height: size,
        background: avatarColor(consultant.id),
        fontSize: size * 0.38,
      }}
    >
      {initials(consultant).toUpperCase()}
    </div>
  );
}

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${levelColor[level]}`}>
      {level}
    </span>
  );
}

export function CapacityBar({ used, max = 100 }: { used: number; max?: number }) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const over = used > max;
  const ratio = max > 0 ? (used / max) * 100 : 0;
  const color =
    over ? "bg-destructive" : ratio >= 85 ? "bg-warning" : ratio >= 40 ? "bg-info" : "bg-success";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}
