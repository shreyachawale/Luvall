import { CalendarDays, Clock4, LayoutDashboard, UserRound, Users } from "lucide-react";
import { Outlet } from "react-router";

import { PortalShell } from "@/components/portal/shell";

const NAV = [
  { href: "/coach", label: "Today", icon: LayoutDashboard, exact: true },
  { href: "/coach/schedule", label: "Schedule & history", icon: CalendarDays },
  { href: "/coach/batches", label: "My batches", icon: Users },
  { href: "/coach/hours", label: "Hours & earnings", icon: Clock4 },
  { href: "/coach/profile", label: "Profile", icon: UserRound },
];

export default function CoachLayout() {
  return <PortalShell area="coach" nav={NAV}><Outlet /></PortalShell>;
}
