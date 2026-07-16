import { createFileRoute } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppHeader } from "@/components/app-header";
import {
  DEMAND_STATUSES,
  LEVELS,
  ROLES,
  useStore,
  usedCapacity,
} from "@/lib/store";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Capacity Board" },
      {
        name: "description",
        content:
          "Visual analytics on team utilization, demand pipeline, and staffing by role and level.",
      },
      { property: "og:title", content: "Analytics — Capacity Board" },
      {
        property: "og:description",
        content: "Utilization, pipeline and staffing insights.",
      },
    ],
  }),
  component: AnalyticsPage,
});

const CHART_COLORS = [
  "oklch(0.68 0.12 240)",
  "oklch(0.72 0.15 165)",
  "oklch(0.78 0.15 75)",
  "oklch(0.65 0.18 20)",
  "oklch(0.6 0.15 300)",
  "oklch(0.7 0.14 130)",
];

const STATUS_COLORS: Record<string, string> = {
  Incoming: "oklch(0.68 0.12 240)",
  "In Progress": "oklch(0.78 0.15 75)",
  Won: "oklch(0.68 0.14 155)",
  Lost: "oklch(0.7 0.02 260)",
};

function AnalyticsPage() {
  const { consultants, demands } = useStore();

  const utilization = consultants
    .map((c) => ({
      name: `${c.name} ${c.surname[0]}.`,
      used: Math.min(usedCapacity(c.id, demands), 100),
      free: Math.max(100 - usedCapacity(c.id, demands), 0),
    }))
    .sort((a, b) => b.used - a.used);

  const statusData = DEMAND_STATUSES.map((s) => ({
    name: s,
    value: demands.filter((d) => d.status === s).length,
    fill: STATUS_COLORS[s],
  }));

  const roleData = ROLES.map((r) => {
    const team = consultants.filter((c) => c.role === r);
    const capacity = team.length * 100;
    const used = team.reduce((s, c) => s + usedCapacity(c.id, demands), 0);
    return {
      role: r,
      team: team.length,
      utilization: capacity ? Math.round((used / capacity) * 100) : 0,
    };
  });

  const levelData = LEVELS.map((l) => ({
    level: l,
    count: consultants.filter((c) => c.level === l).length,
  }));

  const typeData = ["Project", "Topic", "RfP"].map((t, i) => ({
    name: t,
    value: demands.filter((d) => d.type === t).length,
    fill: CHART_COLORS[i],
  }));

  const totalCapacity = consultants.length * 100;
  const usedTotal = consultants.reduce((s, c) => s + usedCapacity(c.id, demands), 0);
  const utilizationPct = totalCapacity ? Math.round((usedTotal / totalCapacity) * 100) : 0;
  const bench = consultants.filter((c) => usedCapacity(c.id, demands) === 0).length;
  const overbooked = consultants.filter((c) => usedCapacity(c.id, demands) > 100).length;
  const winRate = (() => {
    const closed = demands.filter((d) => d.status === "Won" || d.status === "Lost").length;
    const won = demands.filter((d) => d.status === "Won").length;
    return closed ? Math.round((won / closed) * 100) : 0;
  })();

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1600px] px-6 pb-10 pt-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Team utilization and pipeline health at a glance.
          </p>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Overall utilization" value={`${utilizationPct}%`} />
          <Kpi label="On the bench" value={bench.toString()} sub="consultants at 0%" />
          <Kpi label="Overbooked" value={overbooked.toString()} sub=">100% allocated" />
          <Kpi label="Win rate" value={`${winRate}%`} sub="of closed demand" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Utilization per consultant" hint="Stacked used vs free capacity">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={utilization} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis unit="%" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="used" stackId="c" name="Used" fill="oklch(0.68 0.12 240)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="free" stackId="c" name="Free" fill="oklch(0.9 0.02 250)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Demand by status" hint="Distribution across the pipeline">
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={2}
                  label={(e) => (e.value ? `${e.name}: ${e.value}` : "")}
                >
                  {statusData.map((s) => (
                    <Cell key={s.name} fill={s.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Utilization by role" hint="How each practice is loaded">
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={roleData}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="role" tick={{ fontSize: 11 }} />
                <Radar
                  name="Utilization %"
                  dataKey="utilization"
                  stroke="oklch(0.32 0.08 255)"
                  fill="oklch(0.32 0.08 255)"
                  fillOpacity={0.35}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    fontSize: 12,
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Team composition by level" hint="Seniority mix">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={levelData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="level" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" name="Consultants" radius={[6, 6, 0, 0]}>
                  {levelData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Demand mix by type" hint="Projects vs topics vs RfPs" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={typeData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Count"
                  stroke="oklch(0.68 0.12 240)"
                  strokeWidth={3}
                  dot={{ r: 5, fill: "oklch(0.68 0.12 240)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ChartCard({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={"rounded-2xl border bg-surface p-4 " + (className ?? "")}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
