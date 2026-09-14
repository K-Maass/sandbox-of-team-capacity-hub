import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, LayoutDashboard, LogOut, UserCircle, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/auth";
import { useCapacityRealtime } from "@/lib/data";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useSession();
  useCapacityRealtime();

  const links = [
    { to: "/", label: "Board", icon: LayoutDashboard },
    { to: "/consultants", label: "Team", icon: Users },
    { to: "/analytics", label: "Insights", icon: BarChart3 },
    { to: "/profile", label: "My profile", icon: UserCircle },
  ];

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

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
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user && (
            <>
              <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground lg:inline">
                {user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
