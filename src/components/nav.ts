import { can, type Capability, type Principal } from "@/domain/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  caps: Capability[]; // any of
  match?: string; // path prefix for active state
}

export const NAV: NavItem[] = [
  { href: "/group", label: "Group overview", icon: "overview", caps: ["group.dashboard"] },
  { href: "/dealerships", label: "Dealerships", icon: "building", caps: ["dealership.dashboard"] },
  { href: "/jobs", label: "Service jobs", icon: "wrench", caps: ["jobs.view"] },
  { href: "/bodyshop", label: "Body shop", icon: "spray", caps: ["jobs.view"] },
  { href: "/appointments", label: "Appointments", icon: "calendar", caps: ["appointments.manage"] },
  { href: "/reports/daily", label: "Daily report", icon: "report", caps: ["daily_report.submit", "daily_report.group"], match: "/reports" },
  { href: "/alerts", label: "Management actions", icon: "alert", caps: ["alerts.view"] },
  { href: "/finance", label: "Finance & targets", icon: "coins", caps: ["financials.view", "transactions.manage"] },
  { href: "/notifications", label: "Customer updates", icon: "bell", caps: ["notifications.view"] },
  { href: "/admin", label: "Administration", icon: "settings", caps: ["admin.users", "admin.master_data"] },
  { href: "/admin/audit", label: "Audit trail", icon: "shield", caps: ["audit.view"], match: "/admin/audit" },
];

export function navFor(p: Principal): NavItem[] {
  return NAV.filter((n) => n.caps.some((c) => can(p, c)));
}
