import { can, type Capability, type Principal } from "@/domain/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  caps: Capability[]; // any of
  match?: string; // path prefix for active state
  group: NavGroup;
}

export const NAV_GROUPS = ["Leadership", "Sales & showroom", "After-sales", "Reports & finance", "Administration"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export const NAV: NavItem[] = [
  { href: "/group", label: "Overview", icon: "overview", caps: ["group.dashboard"], group: "Leadership" },
  { href: "/dealerships", label: "Dealerships", icon: "building", caps: ["dealership.dashboard"], group: "Leadership" },
  { href: "/front-desk", label: "Front desk", icon: "users", caps: ["frontdesk.view"], group: "Sales & showroom" },
  { href: "/leads/performance", label: "Car enquiries", icon: "car", caps: ["leads.view"], match: "/leads", group: "Sales & showroom" },
  { href: "/prospects", label: "Future prospects", icon: "spark", caps: ["prospects.view"], group: "Sales & showroom" },
  { href: "/jobs", label: "Service jobs", icon: "wrench", caps: ["jobs.view"], group: "After-sales" },
  { href: "/bodyshop", label: "Body shop", icon: "spray", caps: ["jobs.view"], group: "After-sales" },
  { href: "/appointments", label: "Appointments", icon: "calendar", caps: ["appointments.manage"], group: "After-sales" },
  { href: "/reports/daily", label: "Daily report", icon: "report", caps: ["daily_report.submit", "daily_report.group"], match: "/reports", group: "Reports & finance" },
  { href: "/alerts", label: "Management actions", icon: "alert", caps: ["alerts.view"], group: "Leadership" },
  { href: "/finance", label: "Finance & targets", icon: "coins", caps: ["financials.view", "transactions.manage"], group: "Reports & finance" },
  { href: "/notifications", label: "Customer updates", icon: "bell", caps: ["notifications.view"], group: "After-sales" },
  { href: "/admin", label: "Users & settings", icon: "settings", caps: ["admin.users", "admin.master_data"], group: "Administration" },
  { href: "/admin/audit", label: "Audit trail", icon: "shield", caps: ["audit.view"], match: "/admin/audit", group: "Administration" },
];

export function navFor(p: Principal): NavItem[] {
  return NAV.filter((n) => n.caps.some((c) => can(p, c)));
}
