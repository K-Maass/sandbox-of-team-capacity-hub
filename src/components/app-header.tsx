import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, Download, LayoutDashboard, Users } from "lucide-react";

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const links = [
    { to: "/", label: "Board", icon: LayoutDashboard },
    { to: "/consultants", label: "Consultants", icon: Users },
    { to: "/analytics", label: "Analytics", icon: BarChart3 },
  ];
  return (
    <header className="sticky top-0 z-20 border-b bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-6">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            C
          </div>
          <span className="text-sm font-semibold tracking-tight">Capacity Board</span>
        </div>
        <nav className="flex items-center gap-1">
          {links.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors " +
                  (active
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground")
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a
            href="/api/public/export/zip"
            download
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export ZIP</span>
          </a>
        </div>
      </div>
    </header>
  );
}
