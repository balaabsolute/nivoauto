/**
 * Role-based access (brief §11). Least privilege; final matrix to be validated with Kun.
 *
 * Two dimensions:
 *  1. Capability — what a role may do (matrix below).
 *  2. Scope — which dealerships' records a user may see. Group roles (md, group_finance, admin)
 *     are group-wide; everyone else is limited to their assigned dealerships. Technicians are
 *     further limited to jobs assigned to them.
 */
import type { Role } from "@/db/schema";

export const ROLE_LABELS: Record<Role, string> = {
  md: "Managing Director / Group leadership",
  group_finance: "Group operations / finance",
  dealership_manager: "Dealership manager",
  service_advisor: "Service advisor",
  technician: "Technician / body shop staff",
  admin: "Administrator",
  sales_consultant: "Sales consultant",
  kiosk: "Kiosk device (showroom / lounge)",
};

export const CAPABILITIES = [
  "group.dashboard",
  "dealership.dashboard",
  "financials.view",
  "jobs.view",
  "jobs.create",
  "jobs.manage", // edit any field, move any stage, approvals, cancel
  "jobs.work", // update assigned jobs: work-stage moves, checklist, parts requests, photos, labour
  "customers.contact", // see phone/email
  "appointments.manage",
  "daily_report.submit",
  "daily_report.group",
  "transactions.manage",
  "imports.run",
  "reconciliation.manage",
  "targets.manage",
  "alerts.view",
  "alerts.manage",
  "notifications.view",
  "notifications.retry",
  "admin.users",
  "admin.master_data",
  "admin.workflow",
  "audit.view",
  "frontdesk.view", // walk-in queue
  "leads.view",
  "leads.manage", // update enquiries, test drives, follow-ups, outcomes
  "leads.assign", // (re)assign consultants, reopen
  "model_updates.manage", // publish nurture updates
  "prospects.view", // lounge feedback / future prospects
  "catalogue.manage", // car models & kiosk devices
  "kiosk.submit", // device account: submit kiosk forms only
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const MATRIX: Record<Role, Capability[]> = {
  md: [
    "group.dashboard", "dealership.dashboard", "financials.view", "jobs.view", "daily_report.group",
    "alerts.view", "alerts.manage", "notifications.view", "audit.view", "leads.view", "prospects.view",
  ],
  group_finance: [
    "group.dashboard", "dealership.dashboard", "financials.view", "jobs.view", "daily_report.group",
    "transactions.manage", "imports.run", "reconciliation.manage", "targets.manage",
    "alerts.view", "alerts.manage", "notifications.view", "audit.view",
  ],
  dealership_manager: [
    "dealership.dashboard", "financials.view", "jobs.view", "jobs.create", "jobs.manage", "customers.contact",
    "appointments.manage", "daily_report.submit", "transactions.manage", "alerts.view", "alerts.manage",
    "notifications.view", "notifications.retry",
    "frontdesk.view", "leads.view", "leads.manage", "leads.assign", "model_updates.manage", "prospects.view", "catalogue.manage",
  ],
  service_advisor: [
    "jobs.view", "jobs.create", "jobs.manage", "customers.contact", "appointments.manage",
    "notifications.view", "notifications.retry", "daily_report.submit", "frontdesk.view",
  ],
  technician: ["jobs.view", "jobs.work"],
  admin: ["admin.users", "admin.master_data", "admin.workflow", "audit.view", "notifications.view", "catalogue.manage"],
  sales_consultant: ["frontdesk.view", "leads.view", "leads.manage", "prospects.view", "customers.contact", "notifications.view", "daily_report.submit"],
  kiosk: ["kiosk.submit"],
};

export interface Principal {
  id: string;
  role: Role;
  dealershipIds: string[]; // assigned scope (ignored for group-wide roles)
}

export const GROUP_WIDE_ROLES: Role[] = ["md", "group_finance", "admin"];

export function can(p: Pick<Principal, "role">, cap: Capability): boolean {
  return MATRIX[p.role]?.includes(cap) ?? false;
}

export function capabilitiesOf(role: Role): Capability[] {
  return [...MATRIX[role]];
}

export function isGroupWide(p: Pick<Principal, "role">): boolean {
  return GROUP_WIDE_ROLES.includes(p.role);
}

/** "all" or the explicit list of dealership ids the principal may see. */
export function dealershipScope(p: Principal): "all" | string[] {
  return isGroupWide(p) ? "all" : [...p.dealershipIds];
}

export function canAccessDealership(p: Principal, dealershipId: string): boolean {
  return isGroupWide(p) || p.dealershipIds.includes(dealershipId);
}

/** Filter a list of dealership ids down to the principal's scope. */
export function scopeDealerships(p: Principal, ids: string[]): string[] {
  return isGroupWide(p) ? ids : ids.filter((id) => p.dealershipIds.includes(id));
}

export function canViewJob(p: Principal, job: { dealershipId: string; assignedToId: string | null }): boolean {
  if (!can(p, "jobs.view") || !canAccessDealership(p, job.dealershipId)) return false;
  if (p.role === "technician") return job.assignedToId === p.id;
  return true;
}

/**
 * Stage-move permission. Managers/advisors may make any valid move; technicians may only move
 * their own assigned jobs forward out of a work stage or into QC, never into billing/delivery,
 * approvals, and never rework.
 */
export function canMoveJob(
  p: Principal,
  job: { dealershipId: string; assignedToId: string | null },
  move: { fromCommon: string; toCommon: string; direction: "forward" | "rework" },
): boolean {
  if (!canAccessDealership(p, job.dealershipId)) return false;
  if (can(p, "jobs.manage")) return true;
  if (can(p, "jobs.work") && job.assignedToId === p.id) {
    const workish = ["in_progress", "denting", "painting", "finishing"];
    return move.direction === "forward" && workish.includes(move.fromCommon) && [...workish, "quality_check"].includes(move.toCommon);
  }
  return false;
}

/** Where a user lands after login. */
export function homePathFor(p: Principal): string {
  switch (p.role) {
    case "md":
    case "group_finance":
      return "/group";
    case "dealership_manager":
      return p.dealershipIds.length === 1 ? `/dealerships/${p.dealershipIds[0]}` : "/dealerships";
    case "service_advisor":
      return "/jobs";
    case "technician":
      return "/jobs?mine=1";
    case "admin":
      return "/admin";
    case "sales_consultant":
      return "/leads";
    case "kiosk":
      return "/kiosk";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertCan(p: Principal, cap: Capability): void {
  if (!can(p, cap)) throw new ForbiddenError();
}
export function assertDealership(p: Principal, dealershipId: string): void {
  if (!canAccessDealership(p, dealershipId)) throw new ForbiddenError("This dealership is outside your access scope");
}
