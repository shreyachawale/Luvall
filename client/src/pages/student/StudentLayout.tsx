import { CalendarDays, CreditCard, History, LayoutDashboard, RefreshCcw, Search, UserRound } from "lucide-react";
import { Outlet } from "react-router";

import { PortalShell } from "@/components/portal/shell";

const NAV = [
  { href: "/student", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/student/sessions", label: "My sessions", icon: CalendarDays },
  { href: "/student/makeups", label: "Make-ups", icon: RefreshCcw },
  { href: "/student/payments", label: "Package & payments", icon: CreditCard },
  { href: "/student/attendance", label: "Attendance", icon: History },
  { href: "/batches", label: "Browse batches", icon: Search },
  { href: "/student/profile", label: "Profile", icon: UserRound },
];

export default function StudentLayout() {
  return (
    <PortalShell area="student" nav={NAV}>
      <Outlet />
    </PortalShell>
  );
}
