import { createFileRoute } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DataError } from "@/components/data-error";
import {
  DEMAND_STATUSES,
  demandOverlapsDate,
  demandStatusLabel,
  formatDate,
  formatFte,
  ROLES,
  todayIsoDate,
  usedCapacity,
} from "@/lib/types";
import { useBoardData } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Insights — Capacity Board" },
      {
        name: "description",
        content:
          "Simple staffing insights: utilization, availability, overbooking and staffing gaps.",
      },
      { property: "og:title", content: "Insights — Capacity Board" },
      {
        property: "og:description",
        content: "See what needs attention across team capacity and demand.",
      },
    ],
  }),
  component: InsightsPage,
});

const STATUS_COLORS: Record<string, string> = {
  Incoming: "oklch(0.68 0.12 240)",
  "In Progress": "oklch(0.78 0.15 75)",
  Won: "oklch(0.68 0.14 155)",
  Lost: "oklch(0.7 0.02 260)",
};

function InsightsPage() {
  const { consultants, demands, allocations, error } = useBoardData();
  const capacityDate = todayIsoDate();

  const consultantUtilization = consultants
    .map((consultant) => {
      const actual = usedCapacity(consultant.id, demands, allocations, capacityDate);
      return {
        id: consultant.id,
        name: `${consultant.name} ${consultant.surname[0]}.`,
        fullName: `${consultant.name} ${consultant.surname}`,
        actual,
        workingCapacity: consultant.workingCapacity,
        used: Math.min(actual, consultant.workingCapacity),
        free: Math.max(consultant.workingCapacity - actual, 0),
        over: Math.max(actual - consultant.workingCapacity, 0),
      };
    })
    .sort((a, b) => b.actual - a.actual);

  const roleData = ROLES.map((role) => {
    const team = consultants.filter((consultant) => consultant.role === role);
    const capacity = team.reduce((sum, consultant) => sum + consultant.workingCapacity, 0);
    const actual = team.reduce(
      (sum, consultant) => sum + usedCapacity(consultant.id, demands, allocations, capacityDate),
      0,
    );
    return {
      role,
      used: Math.min(actual, capacity),
      free: Math.max(capacity - actual, 0),
      over: Math.max(actual - capacity, 0),
    };
  }).filter((row) => row.used || row.free || row.over);

  const statusData = DEMAND_STATUSES.map((status) => ({
    name: demandStatusLabel(status),
    value: demands.filter((demand) => demand.status === status).length,
    fill: STATUS_COLORS[status],
  }));

  const staffingGaps = demands
    .filter(
      (demand) =>
        demand.status !== "Lost" &&
        demand.requiredCapacity > 0 &&
        demandOverlapsDate(demand, capacityDate),
    )
    .map((demand) => {
      const staffed = allocations
        .filter((allocation) => allocation.demandId === demand.id)
        .reduce((sum, allocation) => sum + allocation.capacity, 0);
      return {
        id: demand.id,
        title: demand.title,
        gap: Math.max(demand.requiredCapacity - staffed, 0),
      };
    })
    .filter((item) => item.gap > 0)
    .sort((a, b) => b.gap - a.gap);

  const totalCapacity = consultants.reduce(
    (sum, consultant) => sum + consultant.workingCapacity,
    0,
  );
  const usedTotal = consultantUtilization.reduce((sum, consultant) => sum + consultant.actual, 0);
  const available = Math.max(totalCapacity - usedTotal, 0);
  const utilizationPct = totalCapacity ? Math.round((usedTotal / totalCapacity) * 100) : 0;
  const overbooked = consultantUtilization.filter((consultant) => consultant.over > 0);
  const unstaffedDemand = staffingGaps.reduce((sum, item) => sum + item.gap, 0);

  const attentionItems = [
    ...overbooked.map((consultant) => ({
      key: `consultant-${consultant.id}`,
      text: `${consultant.fullName} is ${consultant.over}% over working capacity.`,
      tone: "danger" as const,
    })),
    ...staffingGaps.slice(0, 5).map((item) => ({
      key: `demand-${item.id}`,
      text: `${item.title} still needs ${item.gap}% (${formatFte(item.gap)}).`,
      tone: "warning" as const,
    })),
  ].slice(0, 6);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1600px] px-6 pb-10 pt-6">
        <DataError error={error} />
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground">
            What needs attention today, without the reporting overhead.
          </p>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Utilization"
            value={totalCapacity ? `${utilizationPct}%` : "—"}
            sub={totalCapacity ? `on ${formatDate(capacityDate)}` : "No team yet"}
          />
          <Kpi
            label="Available"
            value={totalCapacity ? formatFte(available) : "—"}
            sub={totalCapacity ? `${available}% free capacity` : "No team yet"}
          />
          <Kpi
            label="Overbooked"
            value={overbooked.length.toString()}
            sub="people above capacity"
          />
          <Kpi
            label="Unstaffed demand"
            value={demands.length ? formatFte(unstaffedDemand) : "—"}
            sub={demands.length ? `${unstaffedDemand}% staffing gap` : "No demand yet"}
          />
        </div>

        <div className="mb-4 rounded-2xl border bg-surface p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Needs attention</h2>
            <p className="text-xs text-muted-foreground">
              The staffing issues worth looking at first.
            </p>
          </div>
          {attentionItems.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {attentionItems.map((item) => (
                <div
                  key={item.key}
                  className="flex items-start gap-2 rounded-lg bg-muted/35 px-3 py-2.5 text-sm"
                >
                  <AlertTriangle
                    className={`mt-0.5 h-4 w-4 shrink-0 ${item.tone === "danger" ? "text-destructive" : "text-warning-foreground"}`}
                  />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-3 text-sm text-success-foreground">
              <CheckCircle2 className="h-4 w-4" />
              No overbooking or open staffing gaps need attention right now.
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Utilization by person" hint="Allocated, free and overbooked capacity">
            {consultants.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={consultantUtilization}
                  margin={{ top: 8, right: 16, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis unit="%" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="used"
                    stackId="capacity"
                    name="Allocated"
                    fill="oklch(0.68 0.12 240)"
                  />
                  <Bar dataKey="free" stackId="capacity" name="Free" fill="oklch(0.9 0.02 250)" />
                  <Bar
                    dataKey="over"
                    stackId="capacity"
                    name="Overbooked"
                    fill="oklch(0.6 0.22 25)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty text="Add team members and allocations to see utilization." />
            )}
          </ChartCard>

          <ChartCard
            title="Capacity by role"
            hint="Where the team has room — and where it does not"
          >
            {roleData.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={roleData}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    unit="%"
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    type="category"
                    dataKey="role"
                    width={78}
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="used"
                    stackId="capacity"
                    name="Allocated"
                    fill="oklch(0.68 0.12 240)"
                  />
                  <Bar dataKey="free" stackId="capacity" name="Free" fill="oklch(0.9 0.02 250)" />
                  <Bar
                    dataKey="over"
                    stackId="capacity"
                    name="Overbooked"
                    fill="oklch(0.6 0.22 25)"
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty text="Capacity by role will appear once the team is populated." />
            )}
          </ChartCard>

          <ChartCard
            title="Demand by status"
            hint="A simple view of the staffing pipeline"
            className="lg:col-span-2"
          >
            {demands.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={105}
                    paddingAngle={2}
                    label={(entry) => (entry.value ? `${entry.name}: ${entry.value}` : "")}
                  >
                    {statusData.map((status) => (
                      <Cell key={status.name} fill={status.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty text="Create demand to see the pipeline distribution." />
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  fontSize: 12,
};

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
    <div className={`rounded-2xl border bg-surface p-4 ${className ?? ""}`}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed bg-muted/15 px-6 text-center">
      <div>
        <p className="text-sm font-medium">Nothing to show yet</p>
        <p className="mt-1 text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
