import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { dailyReports, dealerships, alerts, users, userDealerships } from "@/db/schema";
import { assertCan, assertDealership, can, dealershipScope, ForbiddenError } from "@/domain/permissions";
import { businessDate, isIsoDate, addDays } from "@/domain/periods";
import type { Actor } from "../principal";
import { audit } from "../audit";
import { NotFoundError, ValidationError } from "../errors";
import { demoFilter } from "../data-mode";

/* ───────────────────────── Daily report (dealership submission) ───────────────────────── */

const count = z.union([z.coerce.number().int().min(0).max(100_000), z.null()]).optional();
export const dailyReportInput = z.object({
  dealershipId: z.string().uuid(),
  businessDate: z.string().refine(isIsoDate, "Invalid date"),
  leads: count,
  bookings: count,
  bookingCancellations: count,
  expectedDeliveries7d: count,
  availableBayHoursOverride: z.union([z.coerce.number().min(0).max(10_000), z.null()]).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  submit: z.boolean().default(false),
});

/**
 * Daily dealership report: the sales pipeline figures not yet captured transactionally (leads,
 * bookings, cancellations, expected deliveries) plus any capacity override for the day.
 * Revenue, jobs and utilisation come from records, never from this form (capture once).
 */
export async function saveDailyReport(db: DB, actor: Actor, raw: z.input<typeof dailyReportInput>) {
  assertCan(actor, "daily_report.submit");
  const parsed = dailyReportInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const input = parsed.data;
  assertDealership(actor, input.dealershipId);
  const today = businessDate();
  if (input.businessDate > today) throw new ValidationError(["Cannot report for a future date"]);
  if (input.businessDate < addDays(today, -7) && actor.role !== "dealership_manager") throw new ValidationError(["Reports older than 7 days can only be corrected by the dealership manager"]);
  if (input.submit && input.bookings == null && input.leads == null) throw new ValidationError(["Enter at least leads and bookings before submitting (use 0 if none)"]);
  const [before] = await db.select().from(dailyReports).where(and(eq(dailyReports.dealershipId, input.dealershipId), eq(dailyReports.businessDate, input.businessDate)));
  const values = {
    dealershipId: input.dealershipId,
    businessDate: input.businessDate,
    leads: input.leads ?? null,
    bookings: input.bookings ?? null,
    bookingCancellations: input.bookingCancellations ?? null,
    expectedDeliveries7d: input.expectedDeliveries7d ?? null,
    availableBayHoursOverride: input.availableBayHoursOverride ?? null,
    notes: input.notes ?? null,
    status: input.submit ? ("submitted" as const) : (before?.status ?? ("draft" as const)),
    isDemo: (await db.select({ d: dealerships.isDemo }).from(dealerships).where(eq(dealerships.id, input.dealershipId)))[0]?.d ?? false,
    submittedById: input.submit ? actor.id : before?.submittedById ?? null,
    submittedAt: input.submit ? new Date() : before?.submittedAt ?? null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(dailyReports)
    .values(values)
    .onConflictDoUpdate({ target: [dailyReports.dealershipId, dailyReports.businessDate], set: values })
    .returning();
  await audit(db, { userId: actor.id, action: before ? "daily_report.update" : "daily_report.create", entityType: "daily_report", entityId: row.id, dealershipId: row.dealershipId, before: before ?? null, after: row });
  return row;
}

export async function getDailyReport(db: DB, actor: Actor, dealershipId: string, date: string) {
  assertDealership(actor, dealershipId);
  const [r] = await db
    .select({ r: dailyReports, submittedBy: users.name })
    .from(dailyReports)
    .leftJoin(users, eq(users.id, dailyReports.submittedById))
    .where(and(eq(dailyReports.dealershipId, dealershipId), eq(dailyReports.businessDate, date), demoFilter(dailyReports.isDemo)));
  return r ?? null;
}

export async function reportStatusForDate(db: DB, actor: Actor, date: string) {
  const scope = dealershipScope(actor);
  const ds = await db
    .select({ id: dealerships.id, name: dealerships.name, hasSales: dealerships.hasSales })
    .from(dealerships)
    .where(and(eq(dealerships.active, true), demoFilter(dealerships.isDemo), scope === "all" ? undefined : scope.length ? inArray(dealerships.id, scope) : sql`false`))
    .orderBy(asc(dealerships.name));
  const reps = ds.length
    ? await db.select({ r: dailyReports, by: users.name }).from(dailyReports).leftJoin(users, eq(users.id, dailyReports.submittedById)).where(and(eq(dailyReports.businessDate, date), inArray(dailyReports.dealershipId, ds.map((d) => d.id))))
    : [];
  return ds.map((d) => ({ dealer: d, report: reps.find((x) => x.r.dealershipId === d.id) ?? null }));
}

/* ───────────────────────── Management actions on alerts ───────────────────────── */

export const alertUpdateInput = z.object({
  status: z.enum(["open", "acknowledged", "in_progress", "resolved", "dismissed"]).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueDate: z.string().refine(isIsoDate, "Invalid date").nullable().optional(),
  resolutionNote: z.string().trim().max(2000).nullable().optional(),
});

export async function updateAlert(db: DB, actor: Actor, alertId: string, raw: z.input<typeof alertUpdateInput>) {
  assertCan(actor, "alerts.manage");
  const parsed = alertUpdateInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message));
  const patch = parsed.data;
  const [a] = await db.select().from(alerts).where(eq(alerts.id, alertId));
  if (!a) throw new NotFoundError("Alert not found");
  if (a.dealershipId) assertDealership(actor, a.dealershipId);
  if ((patch.status === "resolved" || patch.status === "dismissed") && !(patch.resolutionNote ?? a.resolutionNote)) {
    throw new ValidationError(["Add a note describing the action taken or why the alert is dismissed"]);
  }
  if (patch.ownerId) {
    const [u] = await db.select().from(users).where(eq(users.id, patch.ownerId));
    if (!u || !u.active) throw new ValidationError(["Owner must be an active user"]);
  }
  const [row] = await db.update(alerts).set(patch).where(eq(alerts.id, alertId)).returning();
  await audit(db, { userId: actor.id, action: "alert.update", entityType: "alert", entityId: alertId, dealershipId: a.dealershipId, before: { status: a.status, ownerId: a.ownerId, dueDate: a.dueDate }, after: patch });
  return row;
}

export async function listAlerts(db: DB, actor: Actor, opts: { includeClosed?: boolean } = {}) {
  assertCan(actor, "alerts.view");
  const scope = dealershipScope(actor);
  return db
    .select({ a: alerts, dealershipName: dealerships.name, ownerName: users.name })
    .from(alerts)
    .leftJoin(dealerships, eq(dealerships.id, alerts.dealershipId))
    .leftJoin(users, eq(users.id, alerts.ownerId))
    .where(and(
      scope === "all" ? undefined : scope.length ? inArray(alerts.dealershipId, scope) : sql`false`,
      opts.includeClosed ? undefined : sql`${alerts.status} not in ('resolved','dismissed')`,
      demoFilter(dealerships.isDemo),
    ))
    .orderBy(desc(alerts.active), sql`case ${alerts.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`, desc(alerts.lastSeenAt))
    .limit(300);
}

/** Users who may own an action for a dealership: managers of it + group leadership/finance. */
export async function alertOwnerOptions(db: DB, actor: Actor, dealershipId: string | null) {
  if (!can(actor, "alerts.manage")) throw new ForbiddenError();
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role, d: userDealerships.dealershipId })
    .from(users)
    .leftJoin(userDealerships, eq(userDealerships.userId, users.id))
    .where(and(eq(users.active, true), inArray(users.role, ["md", "group_finance", "dealership_manager", "service_advisor"])));
  const seen = new Map<string, { id: string; name: string; role: string }>();
  for (const r of rows) {
    const eligible = r.role === "md" || r.role === "group_finance" || (dealershipId && r.d === dealershipId);
    if (eligible) seen.set(r.id, { id: r.id, name: r.name, role: r.role });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
