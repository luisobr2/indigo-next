import {
  LayoutDashboard,
  ListChecks,
  CheckCircle2,
  Ruler,
  Pencil,
  Hammer,
  Brush,
  Truck,
  Map,
  Receipt,
  BarChart3,
  Settings,
  Boxes,
  KanbanSquare,
  type LucideIcon,
} from "lucide-react";
import type { SessionPayload } from "./odoo/types";
import { deriveRole } from "./odoo/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  show?: (role: ReturnType<typeof deriveRole>) => boolean;
}

const allManagerOrOffice = (r: ReturnType<typeof deriveRole>) =>
  r.isManager || r.isOffice;

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: allManagerOrOffice },
  { href: "/orders", label: "Orders", icon: ListChecks },
  { href: "/kanban", label: "Kanban", icon: KanbanSquare, show: allManagerOrOffice },
  { href: "/design-approval", label: "Design Approval", icon: CheckCircle2, show: allManagerOrOffice },
  { href: "/measurements", label: "Measurements", icon: Ruler },
  { href: "/digitalization", label: "Digitalization", icon: Pencil, show: (r) => allManagerOrOffice(r) || r.isDesigner },
  { href: "/cnc-production", label: "CNC Production", icon: Hammer, show: (r) => allManagerOrOffice(r) || r.isCnc },
  { href: "/paint", label: "Paint", icon: Brush, show: (r) => allManagerOrOffice(r) || r.isPainter },
  { href: "/installations", label: "Installations", icon: Truck },
  { href: "/route-planner", label: "Route Planner", icon: Map, show: allManagerOrOffice },
  { href: "/billing", label: "Billing", icon: Receipt, show: allManagerOrOffice },
  { href: "/reports", label: "Reports", icon: BarChart3, show: allManagerOrOffice },
  { href: "/catalog", label: "Catalog", icon: Boxes, show: allManagerOrOffice },
  { href: "/settings", label: "Settings", icon: Settings, show: allManagerOrOffice },
];

export function visibleNav(session: SessionPayload | null): NavItem[] {
  if (!session) return [];
  const role = deriveRole(session.user.groups);
  return NAV_ITEMS.filter((item) => !item.show || item.show(role));
}
