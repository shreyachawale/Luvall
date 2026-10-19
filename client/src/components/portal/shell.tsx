import { LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { mutate } from "swr";

import { Logo } from "@/components/public/site-chrome";
import { Seo } from "@/components/seo";
import { Loading, cx } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

export type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; badge?: number };
export type Me = {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  roles: string[];
  photo_url: string | null;
  student_profile?: Record<string, any>;
  coach_profile?: Record<string, any>;
};

const AREA_LABEL = { admin: "Admin", coach: "Coach", student: "Student" } as const;

/**
 * Sidebar layout for the admin, coach and student portals. Signed-out visitors (401 from /auth/me) are sent to
 * the sign-in page with a `next` link back here; the API still enforces roles on every request.
 */
export function PortalShell({
  area,
  nav,
  children,
}: {
  area: "admin" | "coach" | "student";
  nav: NavItem[];
  children: ReactNode;
}) {
  const { data: me, error } = useApi<Me>("/auth/me");
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const signingOut = useRef(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!signingOut.current && error instanceof ApiError && error.status === 401) {
      navigate(`/login?next=${encodeURIComponent(pathname + search)}`, { replace: true });
    }
  }, [error, navigate, pathname, search]);

  const seo = <Seo fullTitle={`${AREA_LABEL[area]} · LuvAll Sports`} />;
  if (error) return <>{seo}<div className="container-page py-10"><Loading label="Redirecting to sign in…" /></div></>;
  if (!me) return <>{seo}<div className="container-page py-10"><Loading /></div></>;
  if (!me.roles.includes(area)) {
    return (
      <>
        {seo}
        <div className="container-page py-16 text-center">
          <h1 className="text-xl font-semibold">You don&apos;t have access to the {AREA_LABEL[area]} area</h1>
          <Link to="/account" className="mt-4 inline-block font-semibold text-court-700 underline">Go to your dashboard</Link>
        </div>
      </>
    );
  }

  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/"));
  const otherAreas = (["admin", "coach", "student"] as const).filter((a) => a !== area && me.roles.includes(a));
  const signOut = async () => {
    signingOut.current = true;
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    // Drop the cached session (and any deduplicated request) so every /auth/me consumer sees the sign-out.
    await mutate("/auth/me", undefined);
    navigate("/login", { replace: true });
  };

  const navList = (
    <nav className="flex flex-col gap-0.5" aria-label={`${AREA_LABEL[area]} navigation`}>
      {nav.map((item) => {
        const Icon = item.icon;
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            to={item.href}
            className={cx(
              "flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-ball text-court-950" : "text-white/70 hover:bg-white/10 hover:text-white",
            )}
          >
            <Icon size={18} className={active ? "text-court-950" : "text-white/55"} />
            <span className="flex-1">{item.label}</span>
            {!!item.badge && (
              <span className={cx("rounded-full px-1.5 text-xs font-semibold", active ? "bg-court-950 text-ball" : "bg-ball text-court-950")}>
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="space-y-1 border-t border-white/10 pt-4">
      <div className="mb-2 flex items-center gap-3 px-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold text-ball">
          {me.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{me.name}</p>
          <p className="truncate text-xs text-white/55">{me.mobile}</p>
        </div>
      </div>
      {otherAreas.map((a) => (
        <Link key={a} to={`/${a}`} className="block rounded-full px-3.5 py-2 text-sm text-ball hover:bg-white/10">
          Switch to {AREA_LABEL[a]} view
        </Link>
      ))}
      <Link to="/" className="block rounded-full px-3.5 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white">View website</Link>
      <button onClick={signOut} className="flex w-full items-center gap-2 rounded-full px-3.5 py-2 text-left text-sm text-white/70 hover:bg-white/10 hover:text-white">
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      {seo}
      <aside className="court-lines sticky top-0 hidden h-screen flex-col gap-7 overflow-y-auto bg-court-950 px-3 py-6 lg:flex">
        <div className="flex items-center justify-between px-2">
          <Logo name="LuvAll" light />
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-ball">{AREA_LABEL[area]}</span>
        </div>
        <div className="flex-1">{navList}</div>
        {footer}
      </aside>
      <div className="sticky top-0 z-30 flex h-16 items-center justify-between bg-court-950 px-4 lg:hidden">
        <Logo name="LuvAll" light />
        <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white" aria-label="Open menu">
          <Menu />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-court-950/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="ml-auto flex h-full w-[min(20rem,85vw)] flex-col gap-4 overflow-y-auto bg-court-950 px-3 py-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-ball">{AREA_LABEL[area]}</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white"><X size={20} /></button>
            </div>
            <div className="flex-1">{navList}</div>
            {footer}
          </div>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
