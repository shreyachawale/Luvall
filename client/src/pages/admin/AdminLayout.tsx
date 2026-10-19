import {
  BarChart3,
  CalendarCheck,
  CalendarDays,
  Globe,
  GraduationCap,
  History,
  IndianRupee,
  LayoutDashboard,
  MapPin,
  RefreshCcw,
  Settings,
  Tags,
  UserCog,
  Users,
} from "lucide-react";
import { Outlet } from "react-router";

import { PortalShell } from "@/components/portal/shell";
import { useApi } from "@/lib/api";

export default function AdminLayout() {
  const { data } = useApi<{ count: number }>("/admin/payments/pending-count", { refreshInterval: 60000 });
  const nav = [
    { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
    { href: "/admin/students", label: "Students", icon: GraduationCap },
    { href: "/admin/coaches", label: "Coaches", icon: Users },
    { href: "/admin/batches", label: "Batches", icon: CalendarDays },
    { href: "/admin/sessions", label: "Sessions & attendance", icon: CalendarCheck },
    { href: "/admin/makeups", label: "Make-ups", icon: RefreshCcw },
    { href: "/admin/venues", label: "Venues & rates", icon: MapPin },
    { href: "/admin/pricing", label: "Fee plans", icon: Tags },
    { href: "/admin/finance", label: "Finance & ledger", icon: IndianRupee, badge: data?.count },
    { href: "/admin/reports", label: "Reports", icon: BarChart3 },
    { href: "/admin/website", label: "Website & marketing", icon: Globe },
    { href: "/admin/settings", label: "Settings", icon: Settings },
    { href: "/admin/users", label: "Users & access", icon: UserCog },
    { href: "/admin/audit", label: "Activity log", icon: History },
  ];
  return (
    <PortalShell area="admin" nav={nav}>
      <Outlet />
    </PortalShell>
  );
}
