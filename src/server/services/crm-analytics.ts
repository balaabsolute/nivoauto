/** Loads showroom-sales and lounge-prospect records in scope and computes their KPIs for a period. */
import { and, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  leads, testDrives, followUps, notifications, modelUpdates, leadActivities, leadInterests, carModels, customers, users, userDealerships,
  loungeFeedback, brands,
} from "@/db/schema";
import { assertCan, dealershipScope } from "@/domain/permissions";
import { rangeToInstants, businessDate, type Period } from "@/domain/periods";
import { nurtureBlocker, UPGRADE_AGE_YEARS } from "@/domain/crm";
import { salesKpis, prospectKpis, type KProspect } from "@/domain/sales-kpis";
import type { Actor } from "../principal";
import { demoFilter } from "../data-mode";

function scopeIds(actor: Actor, dealershipId?: string | null): string[] | "all" {
  const scope = dealershipScope(actor);
  if (dealershipId) return scope === "all" || scope.includes(dealershipId) ? [dealershipId] : [];
  return scope;
}

export async function salesPerformance(db: DB, actor: Actor, period: Period, dealershipId?: string | null) {
  assertCan(actor, "leads.view");
  const ids = scopeIds(actor, dealershipId);
  const r = rangeToInstants(period);
  const cmp = rangeToInstants(period.comparison);
  const inScope = ids === "all" ? undefined : ids.length ? inArray(leads.dealershipId, ids) : sql`false`;
  // Leads that existed before the period end (open, closing or created in either period).
  const rows = await db
    .select({ l: leads, c: customers })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .where(and(demoFilter(leads.isDemo), inScope, lt(leads.createdAt, r.to), or(eq(leads.status, "open"), gte(leads.closedAt, cmp.from), gte(leads.createdAt, cmp.from))));
  const leadIds = rows.map((x) => x.l.id);
  const byChunk = async <T,>(fn: (chunk: string[]) => Promise<T[]>) => {
    const out: T[] = [];
    for (let i = 0; i < leadIds.length; i += 2000) out.push(...(await fn(leadIds.slice(i, i + 2000))));
    return out;
  };
  const [drives, fus, msgs, acts, ints, ups] = await Promise.all([
    byChunk((c) => db.select({ leadId: testDrives.leadId, completedAt: testDrives.completedAt, status: testDrives.status }).from(testDrives).where(inArray(testDrives.leadId, c))),
    byChunk((c) => db.select({ leadId: followUps.leadId, dueAt: followUps.dueAt, status: followUps.status, completedAt: followUps.completedAt, assignedToId: followUps.assignedToId, modelUpdateId: followUps.modelUpdateId }).from(followUps).where(inArray(followUps.leadId, c))),
    byChunk((c) => db.select({ leadId: notifications.leadId, customerId: notifications.customerId, createdAt: notifications.createdAt, status: notifications.status }).from(notifications).where(and(eq(notifications.event, "model_update"), inArray(notifications.leadId, c), gte(notifications.createdAt, cmp.from)))),
    byChunk((c) => db.select({ leadId: leadActivities.leadId, type: leadActivities.type, at: leadActivities.at, userId: leadActivities.userId }).from(leadActivities).where(inArray(leadActivities.leadId, c))),
    byChunk((c) => db.select({ leadId: leadInterests.leadId, model: carModels.name }).from(leadInterests).innerJoin(carModels, eq(carModels.id, leadInterests.modelId)).where(inArray(leadInterests.leadId, c))),
    db.select({ publishedAt: modelUpdates.publishedAt, dealershipId: modelUpdates.dealershipId }).from(modelUpdates).where(and(demoFilter(modelUpdates.isDemo), isNotNull(modelUpdates.publishedAt), gte(modelUpdates.publishedAt, cmp.from))),
  ]);
  const consultants = await db
    .selectDistinct({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(userDealerships, eq(userDealerships.userId, users.id))
    .where(and(inArray(users.role, ["sales_consultant", "dealership_manager"]), ids === "all" ? undefined : ids.length ? inArray(userDealerships.dealershipId, ids) : sql`false`));
  const k = salesKpis(
    {
      leads: rows.map(({ l, c }) => ({
        id: l.id, createdAt: l.createdAt, closedAt: l.closedAt, status: l.status, source: l.source, consultantId: l.consultantId, timeframe: l.timeframe, lostToBrand: l.lostToBrand,
        nurtureEligible: nurtureBlocker(l.status, c) == null,
      })),
      drives,
      followUps: fus.map((f) => ({ ...f, fromUpdate: !!f.modelUpdateId })),
      nurtureMessages: msgs,
      updatesPublished: ups.filter((u) => ids === "all" || !u.dealershipId || ids.includes(u.dealershipId)).map((u) => ({ publishedAt: u.publishedAt! })),
      activities: acts,
      interests: ints,
      consultants,
    },
    r,
    cmp,
  );
  return k;
}

export async function prospectPerformance(db: DB, actor: Actor, period: Period, dealershipId?: string | null) {
  assertCan(actor, "prospects.view");
  const ids = scopeIds(actor, dealershipId);
  const r = rangeToInstants(period);
  const cmp = rangeToInstants(period.comparison);
  const rows = await db
    .select({ f: loungeFeedback, consentMarketing: customers.consentMarketing, optedOut: customers.marketingOptOutAt, lead: { createdAt: leads.createdAt, status: leads.status, closedAt: leads.closedAt } })
    .from(loungeFeedback)
    .innerJoin(customers, eq(customers.id, loungeFeedback.customerId))
    .leftJoin(leads, eq(leads.id, loungeFeedback.convertedLeadId))
    .where(and(demoFilter(loungeFeedback.isDemo), ids === "all" ? undefined : ids.length ? inArray(loungeFeedback.dealershipId, ids) : sql`false`, lt(loungeFeedback.createdAt, r.to)));
  const modelIds = [...new Set(rows.flatMap((x) => x.f.preferredModelIds ?? []))];
  const models = modelIds.length ? await db.select({ id: carModels.id, name: carModels.name, brand: brands.name }).from(carModels).innerJoin(brands, eq(brands.id, carModels.brandId)).where(inArray(carModels.id, modelIds)) : [];
  const custIds = [...new Set(rows.map((x) => x.f.customerId))];
  const msgs = custIds.length
    ? await db.select({ customerId: notifications.customerId, createdAt: notifications.createdAt }).from(notifications).where(and(eq(notifications.event, "model_update"), sql`${notifications.leadId} is null`, eq(notifications.status, "sent"), inArray(notifications.customerId, custIds), gte(notifications.createdAt, cmp.from)))
    : [];
  const data: KProspect[] = rows.map(({ f, consentMarketing, optedOut, lead }) => {
    const ms = (f.preferredModelIds ?? []).map((id) => models.find((m) => m.id === id)).filter(Boolean) as { name: string; brand: string }[];
    return {
      createdAt: f.createdAt, interest: f.interest, timeframe: f.timeframe, purchaseYear: f.purchaseYear, budgetBand: f.budgetBand, serviceRating: f.serviceRating, status: f.status,
      marketingOk: consentMarketing && !optedOut, currentMake: f.currentMake, preferredBrands: ms.map((m) => m.brand), preferredModels: ms.map((m) => `${m.brand} ${m.name}`),
      convertedLead: lead?.createdAt ? { createdAt: lead.createdAt, status: lead.status!, closedAt: lead.closedAt } : null,
      messagedAt: msgs.filter((m) => m.customerId === f.customerId).map((m) => m.createdAt),
    };
  });
  return prospectKpis(data, r, cmp, Number(businessDate().slice(0, 4)), UPGRADE_AGE_YEARS);
}
