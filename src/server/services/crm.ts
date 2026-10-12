/**
 * Showroom & sales services: kiosk capture, front desk, enquiries (leads), test drives, follow-ups,
 * nurture model updates, lounge feedback and future prospects.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import {
  customers, dealerships, brands, users, userDealerships, carModels, walkIns, leads, leadInterests, testDrives, leadActivities, followUps,
  modelUpdates, loungeFeedback, notifications, jobs,
  VISIT_TYPES, TIMEFRAMES, BUDGET_BANDS, LEAD_STAGES, LEAD_SOURCES, MODEL_UPDATE_TYPES,
  type VisitType, type LeadStatus, type LeadStage,
} from "@/db/schema";
import { assertCan, assertDealership, can, dealershipScope, ForbiddenError, canAccessDealership } from "@/domain/permissions";
import {
  formatToken, validateClose, canChangeStage, nurtureBlocker, prospectMatchesModel, defaultFollowUpAt, hasMarketingPermission, isUpgradeCandidate,
  prospectScore, VISIT_LABELS, type CloseInput, type NurtureSkip,
} from "@/domain/crm";
import { businessDate, isIsoDate } from "@/domain/periods";
import type { Actor } from "../principal";
import { audit } from "../audit";
import { notify } from "../notify/dispatcher";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { demoFilter, DATA_MODE } from "../data-mode";
import { normalisePhone, normaliseReg, createJob } from "./jobs";

type Tx = DB;
const txOf = (t: unknown) => t as Tx;

/* ───────────────────────── Shared helpers ───────────────────────── */

const BUDGET_RANGES: Record<(typeof BUDGET_BANDS)[number], [number | null, number | null]> = {
  under_10l: [null, 1_000_000],
  "10_15l": [1_000_000, 1_500_000],
  "15_25l": [1_500_000, 2_500_000],
  "25_50l": [2_500_000, 5_000_000],
  "50l_1cr": [5_000_000, 10_000_000],
  above_1cr: [10_000_000, null],
};

async function dealershipOr404(db: DB, id: string) {
  const [d] = await db.select().from(dealerships).where(eq(dealerships.id, id));
  if (!d || !d.active || (DATA_MODE === "live" && d.isDemo)) throw new ValidationError(["Dealership not found or inactive"]);
  return d;
}

const contactInput = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(80),
  phone: z.string().trim().refine((p) => /^(\+?91)?[6-9]\d{9}$/.test(p.replace(/[\s-]/g, "")), "Please enter a valid 10-digit mobile number"),
  email: z.string().trim().email("Please check the email address").optional().nullable().or(z.literal("")),
  consentWhatsapp: z.boolean().default(false),
  consentSms: z.boolean().default(false),
  consentEmail: z.boolean().default(false),
  consentMarketing: z.boolean().default(false),
});

/**
 * Find a customer by mobile within the dealership's legal entity, or create one. Consent reflects the
 * customer's latest declaration (recorded with a timestamp). Existing names are not overwritten, and
 * nothing about an existing record is ever returned to a kiosk.
 */
async function upsertCustomerByPhone(tx: Tx, actorId: string, dealer: typeof dealerships.$inferSelect, c: z.infer<typeof contactInput>) {
  const phone = normalisePhone(c.phone)!;
  const [existing] = await tx.select().from(customers).where(and(eq(customers.phone, phone), eq(customers.legalEntityId, dealer.legalEntityId))).limit(1);
  const consent = {
    consentWhatsapp: c.consentWhatsapp,
    consentSms: c.consentSms,
    consentEmail: c.consentEmail,
    consentMarketing: c.consentMarketing,
    consentRecordedAt: new Date(),
    preferredChannel: c.consentWhatsapp ? ("whatsapp" as const) : c.consentSms ? ("sms" as const) : c.consentEmail ? ("email" as const) : null,
  };
  if (existing) {
    const patch: Partial<typeof customers.$inferInsert> = { ...consent };
    if (!existing.email && c.email) patch.email = c.email;
    // Giving marketing consent again clears an earlier opt-out (it is the customer's latest choice).
    if (c.consentMarketing) patch.marketingOptOutAt = null;
    const [u] = await tx.update(customers).set(patch).where(eq(customers.id, existing.id)).returning();
    await audit(tx, { userId: actorId, action: "customer.consent_update", entityType: "customer", entityId: existing.id, dealershipId: dealer.id, before: pickConsent(existing), after: pickConsent(u) });
    return u;
  }
  const [created] = await tx
    .insert(customers)
    .values({ legalEntityId: dealer.legalEntityId, dealershipId: dealer.id, name: c.name, phone, email: c.email || null, ...consent, isDemo: dealer.isDemo })
    .returning();
  await audit(tx, { userId: actorId, action: "customer.create", entityType: "customer", entityId: created.id, dealershipId: dealer.id, after: { name: created.name, consent: pickConsent(created) } });
  return created;
}
function pickConsent(c: typeof customers.$inferSelect) {
  return { whatsapp: c.consentWhatsapp, sms: c.consentSms, email: c.consentEmail, marketing: c.consentMarketing, optOut: c.marketingOptOutAt };
}

async function nextToken(tx: Tx, dealershipId: string, type: VisitType, date: string) {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(walkIns)
    .where(and(eq(walkIns.dealershipId, dealershipId), eq(walkIns.businessDate, date), eq(walkIns.visitType, type)));
  return formatToken(type, Number(n) + 1);
}

async function nextLeadNo(tx: Tx, dealerCode: string) {
  const prefix = `ENQ-${dealerCode}-${businessDate().slice(2, 7).replace("-", "")}-`;
  const [{ n }] = await tx
    .select({ n: sql<number>`coalesce(max(nullif(regexp_replace(substring(${leads.leadNo} from ${prefix.length + 1}::int), '[^0-9]', '', 'g'), '')::int), 0)` })
    .from(leads)
    .where(sql`${leads.leadNo} like ${prefix + "%"}`);
  return `${prefix}${String(Number(n) + 1).padStart(4, "0")}`;
}

async function addActivity(tx: Tx, leadId: string, type: (typeof leadActivities.$inferInsert)["type"], text: string | null, userId: string | null, at?: Date) {
  await tx.insert(leadActivities).values({ leadId, type, text, userId, at: at ?? new Date() });
}

async function modelNames(db: DB, ids: string[]) {
  if (!ids.length) return [];
  return db.select({ id: carModels.id, name: carModels.name, brandId: carModels.brandId }).from(carModels).where(inArray(carModels.id, ids));
}

/* ───────────────────────── Catalogue ───────────────────────── */

export async function catalogueForDealership(db: DB, dealershipId: string) {
  const d = await dealershipOr404(db, dealershipId);
  return db.select().from(carModels).where(and(eq(carModels.brandId, d.brandId), eq(carModels.active, true), demoFilter(carModels.isDemo))).orderBy(asc(carModels.sortOrder), asc(carModels.name));
}

/** All active models across group brands (lounge preferences can cross brands, e.g. Honda owner → BMW). */
export async function groupCatalogue(db: DB) {
  return db
    .select({ m: carModels, brand: brands.name })
    .from(carModels)
    .innerJoin(brands, eq(brands.id, carModels.brandId))
    .where(and(eq(carModels.active, true), demoFilter(carModels.isDemo)))
    .orderBy(asc(brands.name), asc(carModels.sortOrder), asc(carModels.name));
}

export const carModelInput = z.object({
  id: z.string().uuid().optional(),
  brandId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  bodyType: z.string().trim().max(30).nullable().optional(),
  fuelTypes: z.string().trim().max(60).nullable().optional(),
  priceBand: z.string().trim().max(40).nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

export async function saveCarModel(db: DB, actor: Actor, raw: z.input<typeof carModelInput>) {
  assertCan(actor, "catalogue.manage");
  const p = carModelInput.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const { id, ...v } = p.data;
  const [dup] = await db.select({ id: carModels.id }).from(carModels).where(and(eq(carModels.brandId, v.brandId), eq(carModels.name, v.name)));
  if (dup && dup.id !== id) throw new ConflictError("This brand already has a model with that name");
  const [row] = id ? await db.update(carModels).set(v).where(eq(carModels.id, id)).returning() : await db.insert(carModels).values(v).returning();
  await audit(db, { userId: actor.id, action: id ? "car_model.update" : "car_model.create", entityType: "car_model", entityId: row.id, after: v });
  return row;
}

/* ───────────────────────── Kiosk: showroom walk-ins ───────────────────────── */

export const kioskVisitInput = contactInput.extend({
  visitType: z.enum(VISIT_TYPES),
  // new car
  modelIds: z.array(z.string().uuid()).max(5).default([]),
  testDrive: z.boolean().default(false),
  timeframe: z.enum(TIMEFRAMES).nullable().optional(),
  budgetBand: z.enum(BUDGET_BANDS).nullable().optional(),
  exchangeVehicle: z.string().trim().max(120).nullable().optional(),
  // service / parts / body shop
  registrationNo: z.string().trim().max(20).nullable().optional(),
  vehicleModel: z.string().trim().max(60).nullable().optional(),
  request: z.string().trim().max(500).nullable().optional(),
  insuranceClaim: z.boolean().nullable().optional(),
});
export type KioskVisitInput = z.input<typeof kioskVisitInput>;

function kioskDealership(actor: Actor): string {
  if (actor.role !== "kiosk") return "";
  if (actor.dealershipIds.length !== 1) throw new ForbiddenError("This kiosk is not linked to exactly one dealership. Ask an administrator.");
  return actor.dealershipIds[0];
}

/**
 * Capture a visit from a kiosk (or from staff at the front desk). Returns only the token, never
 * customer data. A new-car visit creates (or adds to) an open enquiry.
 */
export async function captureVisit(db: DB, actor: Actor, raw: KioskVisitInput & { dealershipId?: string }, opts: { at?: Date; isDemo?: boolean } = {}) {
  const viaKiosk = actor.role === "kiosk";
  if (viaKiosk) assertCan(actor, "kiosk.submit");
  else assertCan(actor, "frontdesk.view");
  const parsed = kioskVisitInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message));
  const input = parsed.data;
  const dealershipId = viaKiosk ? kioskDealership(actor) : raw.dealershipId ?? "";
  assertDealership(actor, dealershipId);
  const dealer = await dealershipOr404(db, dealershipId);

  if (input.visitType === "new_car") {
    if (!dealer.hasSales) throw new ValidationError(["This showroom doesn’t take new-car enquiries"]);
    if (!input.modelIds.length) throw new ValidationError(["Please choose at least one car you’re interested in"]);
    const models = await db.select().from(carModels).where(inArray(carModels.id, input.modelIds));
    if (models.length !== input.modelIds.length || models.some((m) => m.brandId !== dealer.brandId || !m.active)) throw new ValidationError(["Please choose cars from this showroom’s range"]);
  }
  if (input.visitType === "body_shop" && !dealer.hasBodyShop) throw new ValidationError(["This location doesn’t have a body shop. Please ask at the front desk."]);
  if ((input.visitType === "service" || input.visitType === "body_shop") && !input.registrationNo?.trim()) throw new ValidationError(["Please enter your car’s registration number"]);
  if (input.visitType === "spare_parts" && !input.request?.trim()) throw new ValidationError(["Please tell us which part you need"]);

  const at = opts.at ?? new Date();
  const date = businessDate(at);
  const isDemo = opts.isDemo ?? dealer.isDemo;

  const result = await db.transaction(async (t) => {
    const tx = txOf(t);
    const customer = await upsertCustomerByPhone(tx, actor.id, dealer, input);
    const token = await nextToken(tx, dealer.id, input.visitType, date);
    const [visit] = await tx
      .insert(walkIns)
      .values({
        dealershipId: dealer.id, customerId: customer.id, visitType: input.visitType, token, businessDate: date,
        capturedVia: viaKiosk ? "kiosk" : "staff", kioskUserId: viaKiosk ? actor.id : null,
        registrationNo: input.registrationNo ? normaliseReg(input.registrationNo) : null, vehicleModel: input.vehicleModel || null,
        request: input.request || null, insuranceClaim: input.insuranceClaim ?? null,
        status: viaKiosk ? "waiting" : "attending", attendedById: viaKiosk ? null : actor.id, attendedAt: viaKiosk ? null : at,
        isDemo, createdAt: at,
      })
      .returning();

    let leadId: string | null = null;
    let createdLead = false;
    if (input.visitType === "new_car") {
      // Re-use the customer's open enquiry at this showroom instead of creating a duplicate.
      const [open] = await tx.select().from(leads).where(and(eq(leads.customerId, customer.id), eq(leads.dealershipId, dealer.id), eq(leads.status, "open"))).limit(1);
      const [bMin, bMax] = input.budgetBand ? BUDGET_RANGES[input.budgetBand] : [null, null];
      if (open) {
        leadId = open.id;
        await tx.update(leads).set({
          timeframe: input.timeframe ?? open.timeframe, budgetMin: bMin ?? open.budgetMin, budgetMax: bMax ?? open.budgetMax,
          exchangeVehicle: input.exchangeVehicle || open.exchangeVehicle, walkInId: visit.id, updatedAt: at,
        }).where(eq(leads.id, open.id));
        await addActivity(tx, open.id, "visit", `Visited the showroom again (token ${token})`, null, at);
      } else {
        const leadNo = await nextLeadNo(tx, dealer.code);
        const [l] = await tx
          .insert(leads)
          .values({
            leadNo, dealershipId: dealer.id, customerId: customer.id, source: "walk_in", walkInId: visit.id,
            consultantId: viaKiosk ? null : can(actor, "leads.manage") ? actor.id : null,
            timeframe: input.timeframe ?? null, budgetMin: bMin, budgetMax: bMax, exchangeVehicle: input.exchangeVehicle || null,
            nextFollowUpAt: defaultFollowUpAt("enquiry", at), createdById: actor.id, isDemo, createdAt: at, updatedAt: at,
          })
          .returning();
        leadId = l.id;
        createdLead = true;
        await addActivity(tx, l.id, "created", `Walk-in enquiry captured ${viaKiosk ? "on the showroom kiosk" : "at the front desk"} (token ${token})`, viaKiosk ? null : actor.id, at);
      }
      for (const [i, m] of input.modelIds.entries()) {
        await tx.insert(leadInterests).values({ leadId, modelId: m, isPrimary: i === 0 }).onConflictDoNothing();
      }
      if (input.testDrive) {
        await tx.insert(testDrives).values({ leadId, modelId: input.modelIds[0], status: "requested", createdAt: at });
        await addActivity(tx, leadId, "test_drive", "Customer asked for a test drive", null, at);
      }
      await tx.update(walkIns).set({ leadId }).where(eq(walkIns.id, visit.id));
    }
    await audit(tx, { userId: actor.id, action: "walk_in.capture", entityType: "walk_in", entityId: visit.id, dealershipId: dealer.id, after: { visitType: input.visitType, token, via: visit.capturedVia, leadId } });
    return { visit, customer, leadId, createdLead };
  });

  if (result.createdLead && result.leadId) {
    const names = (await modelNames(db, input.modelIds)).map((m) => m.name).join(", ");
    try {
      await notify(db, { event: "enquiry_received", dealershipId: dealer.id, customerId: result.customer.id, leadId: result.leadId, context: { models: names }, isDemo });
    } catch (e) {
      console.error("[notify] enquiry", e);
    }
  }
  return { token: result.visit.token, visitType: input.visitType, label: VISIT_LABELS[input.visitType], walkInId: result.visit.id, leadId: result.leadId };
}

/* ───────────────────────── Kiosk: lounge feedback ───────────────────────── */

export const loungeInput = contactInput.extend({
  currentMake: z.string().trim().max(40).nullable().optional(),
  currentModel: z.string().trim().max(60).nullable().optional(),
  registrationNo: z.string().trim().max(20).nullable().optional(),
  purchaseYear: z.coerce.number().int().min(1980).max(2100).nullable().optional(),
  serviceRating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  interest: z.enum(["yes", "maybe", "no"]),
  timeframe: z.enum(TIMEFRAMES).nullable().optional(),
  budgetBand: z.enum(BUDGET_BANDS).nullable().optional(),
  preferredBodyType: z.string().trim().max(30).nullable().optional(),
  preferredFuel: z.string().trim().max(30).nullable().optional(),
  preferredModelIds: z.array(z.string().uuid()).max(6).default([]),
  otherPreferences: z.string().trim().max(500).nullable().optional(),
  comments: z.string().trim().max(1000).nullable().optional(),
});
export type LoungeInput = z.input<typeof loungeInput>;

export async function submitLoungeFeedback(db: DB, actor: Actor, raw: LoungeInput & { dealershipId?: string }, opts: { at?: Date; isDemo?: boolean } = {}) {
  if (actor.role === "kiosk") assertCan(actor, "kiosk.submit");
  else assertCan(actor, "prospects.view");
  const parsed = loungeInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message));
  const input = parsed.data;
  if (input.purchaseYear && input.purchaseYear > Number(businessDate().slice(0, 4))) throw new ValidationError(["Purchase year can’t be in the future"]);
  const dealershipId = actor.role === "kiosk" ? kioskDealership(actor) : raw.dealershipId ?? "";
  assertDealership(actor, dealershipId);
  const dealer = await dealershipOr404(db, dealershipId);
  if (input.preferredModelIds.length) {
    const ms = await db.select({ id: carModels.id }).from(carModels).where(and(inArray(carModels.id, input.preferredModelIds), eq(carModels.active, true)));
    if (ms.length !== input.preferredModelIds.length) throw new ValidationError(["Please choose cars from the list"]);
  }
  const at = opts.at ?? new Date();
  return db.transaction(async (t) => {
    const tx = txOf(t);
    const customer = await upsertCustomerByPhone(tx, actor.id, dealer, input);
    const [fb] = await tx
      .insert(loungeFeedback)
      .values({
        dealershipId: dealer.id, customerId: customer.id, kioskUserId: actor.role === "kiosk" ? actor.id : null,
        currentMake: input.currentMake || null, currentModel: input.currentModel || null,
        registrationNo: input.registrationNo ? normaliseReg(input.registrationNo) : null, purchaseYear: input.purchaseYear ?? null,
        serviceRating: input.serviceRating ?? null, interest: input.interest, timeframe: input.timeframe ?? null, budgetBand: input.budgetBand ?? null,
        preferredBodyType: input.preferredBodyType || null, preferredFuel: input.preferredFuel || null, preferredModelIds: input.preferredModelIds,
        otherPreferences: input.otherPreferences || null, comments: input.comments || null,
        status: input.interest === "no" || input.timeframe === "not_planning" ? "not_now" : "new",
        isDemo: opts.isDemo ?? dealer.isDemo, createdAt: at,
      })
      .returning();
    await audit(tx, { userId: actor.id, action: "lounge_feedback.submit", entityType: "lounge_feedback", entityId: fb.id, dealershipId: dealer.id, after: { interest: fb.interest, timeframe: fb.timeframe } });
    return { ok: true as const, upgradeCandidate: isUpgradeCandidate(fb.purchaseYear, businessDate(at)) };
  });
}

/* ───────────────────────── Front desk ───────────────────────── */

export async function listFrontDesk(db: DB, actor: Actor, date: string, dealershipId?: string) {
  assertCan(actor, "frontdesk.view");
  if (!isIsoDate(date)) throw new ValidationError(["Invalid date"]);
  const scope = dealershipScope(actor);
  const conds: (SQL | undefined)[] = [eq(walkIns.businessDate, date), demoFilter(walkIns.isDemo)];
  if (scope !== "all") conds.push(scope.length ? inArray(walkIns.dealershipId, scope) : sql`false`);
  if (dealershipId) conds.push(eq(walkIns.dealershipId, dealershipId));
  // Service advisors see service / parts / body shop visits; sales roles see everything at the desk.
  if (actor.role === "service_advisor") conds.push(ne(walkIns.visitType, "new_car"));
  const showContact = can(actor, "customers.contact");
  const rows = await db
    .select({ w: walkIns, customerName: customers.name, phone: customers.phone, dealershipName: dealerships.name, attendedBy: users.name, leadNo: leads.leadNo, jobNo: jobs.jobNo })
    .from(walkIns)
    .innerJoin(customers, eq(customers.id, walkIns.customerId))
    .innerJoin(dealerships, eq(dealerships.id, walkIns.dealershipId))
    .leftJoin(users, eq(users.id, walkIns.attendedById))
    .leftJoin(leads, eq(leads.id, walkIns.leadId))
    .leftJoin(jobs, eq(jobs.id, walkIns.jobId))
    .where(and(...conds))
    .orderBy(asc(walkIns.createdAt));
  return rows.map((r) => ({ ...r, phone: showContact ? r.phone : null }));
}

async function walkInForStaff(db: DB, actor: Actor, id: string) {
  assertCan(actor, "frontdesk.view");
  const [w] = await db.select().from(walkIns).where(eq(walkIns.id, id));
  if (!w || (DATA_MODE === "live" && w.isDemo)) throw new NotFoundError("Visit not found");
  assertDealership(actor, w.dealershipId);
  return w;
}

export async function attendWalkIn(db: DB, actor: Actor, id: string) {
  const w = await walkInForStaff(db, actor, id);
  if (w.status !== "waiting") throw new ValidationError([`This visitor is already ${w.status === "attending" ? "being attended" : w.status}`]);
  await db.transaction(async (t) => {
    const tx = txOf(t);
    await tx.update(walkIns).set({ status: "attending", attendedById: actor.id, attendedAt: new Date() }).where(eq(walkIns.id, id));
    if (w.leadId && can(actor, "leads.manage")) {
      const [l] = await tx.select().from(leads).where(eq(leads.id, w.leadId));
      if (l && !l.consultantId) {
        await tx.update(leads).set({ consultantId: actor.id, updatedAt: new Date() }).where(eq(leads.id, l.id));
        await addActivity(tx, l.id, "assignment", `Attended at the front desk by ${actor.name}`, actor.id);
      }
    }
    await audit(tx, { userId: actor.id, action: "walk_in.attend", entityType: "walk_in", entityId: id, dealershipId: w.dealershipId });
  });
}

export async function closeWalkIn(db: DB, actor: Actor, id: string, status: "done" | "left", note?: string | null) {
  const w = await walkInForStaff(db, actor, id);
  if (w.status === "done" || w.status === "left") throw new ValidationError(["This visit is already closed"]);
  await db.update(walkIns).set({ status, closedAt: new Date(), outcomeNote: note?.trim() || null, attendedById: w.attendedById ?? actor.id }).where(eq(walkIns.id, id));
  await audit(db, { userId: actor.id, action: `walk_in.${status}`, entityType: "walk_in", entityId: id, dealershipId: w.dealershipId, after: { note } });
}

/** Service / body shop walk-in → job card (capture once). */
export async function openJobFromWalkIn(db: DB, actor: Actor, id: string, extra: { registrationNo?: string | null; complaint?: string | null } = {}) {
  const w = await walkInForStaff(db, actor, id);
  if (w.visitType !== "service" && w.visitType !== "body_shop") throw new ValidationError(["Only service and body shop visits open a job card"]);
  if (w.jobId) throw new ConflictError("A job card is already linked to this visit");
  const [c] = await db.select().from(customers).where(eq(customers.id, w.customerId));
  const job = await createJob(db, actor, {
    dealershipId: w.dealershipId, jobType: w.visitType === "service" ? "service" : "bodyshop", source: "walk_in",
    customerName: c.name, phone: c.phone, email: c.email, registrationNo: extra.registrationNo || w.registrationNo || "",
    model: w.vehicleModel, consentWhatsapp: c.consentWhatsapp, consentSms: c.consentSms, consentEmail: c.consentEmail,
    complaint: extra.complaint || w.request || (w.visitType === "service" ? "Service as requested at the front desk" : "Body repair as requested at the front desk"),
  });
  await db.update(walkIns).set({ jobId: job.id, status: "done", closedAt: new Date(), attendedById: w.attendedById ?? actor.id }).where(eq(walkIns.id, id));
  return job;
}

/* ───────────────────────── Enquiries (leads) ───────────────────────── */

async function leadForStaff(db: DB, actor: Actor, id: string, write = false) {
  assertCan(actor, write ? "leads.manage" : "leads.view");
  const [l] = await db.select().from(leads).where(eq(leads.id, id));
  if (!l || (DATA_MODE === "live" && l.isDemo)) throw new NotFoundError("Enquiry not found");
  if (!canAccessDealership(actor, l.dealershipId)) throw new ForbiddenError("This enquiry is outside your access scope");
  return l;
}

export interface LeadFilters {
  status?: LeadStatus | "all";
  stage?: LeadStage;
  consultantId?: string | "unassigned";
  modelId?: string;
  dealershipId?: string;
  due?: boolean; // follow-up due now or overdue
  q?: string;
}

export async function listLeads(db: DB, actor: Actor, f: LeadFilters = {}) {
  assertCan(actor, "leads.view");
  const scope = dealershipScope(actor);
  const conds: (SQL | undefined)[] = [demoFilter(leads.isDemo)];
  if (scope !== "all") conds.push(scope.length ? inArray(leads.dealershipId, scope) : sql`false`);
  if (f.dealershipId) conds.push(eq(leads.dealershipId, f.dealershipId));
  conds.push(f.status && f.status !== "all" ? eq(leads.status, f.status) : f.status === "all" ? undefined : eq(leads.status, "open"));
  if (f.stage) conds.push(eq(leads.stage, f.stage));
  if (f.consultantId === "unassigned") conds.push(isNull(leads.consultantId));
  else if (f.consultantId) conds.push(eq(leads.consultantId, f.consultantId));
  if (f.due) conds.push(lte(leads.nextFollowUpAt, new Date()));
  if (f.modelId) conds.push(sql`exists (select 1 from lead_interests li where li.lead_id = ${leads.id} and li.model_id = ${f.modelId})`);
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(leads.leadNo, q), ilike(customers.name, q), ilike(customers.phone, `%${f.q.replace(/\D/g, "") || "~"}%`)));
  }
  const rows = await db
    .select({ l: leads, customerName: customers.name, phone: customers.phone, dealershipName: dealerships.name, consultantName: users.name })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .innerJoin(dealerships, eq(dealerships.id, leads.dealershipId))
    .leftJoin(users, eq(users.id, leads.consultantId))
    .where(and(...conds))
    .orderBy(asc(sql`coalesce(${leads.nextFollowUpAt}, ${leads.createdAt})`))
    .limit(500);
  const ids = rows.map((r) => r.l.id);
  const interests = ids.length
    ? await db.select({ leadId: leadInterests.leadId, name: carModels.name, isPrimary: leadInterests.isPrimary }).from(leadInterests).innerJoin(carModels, eq(carModels.id, leadInterests.modelId)).where(inArray(leadInterests.leadId, ids))
    : [];
  const tds = ids.length ? await db.select({ leadId: testDrives.leadId, status: testDrives.status }).from(testDrives).where(inArray(testDrives.leadId, ids)) : [];
  const showContact = can(actor, "customers.contact");
  return rows.map((r) => ({
    ...r,
    phone: showContact ? r.phone : null,
    models: interests.filter((i) => i.leadId === r.l.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((i) => i.name),
    testDrive: tds.find((t) => t.leadId === r.l.id && t.status === "completed") ? "completed" : tds.find((t) => t.leadId === r.l.id && t.status !== "cancelled") ? "requested" : null,
  }));
}

export async function getLead(db: DB, actor: Actor, id: string) {
  const l = await leadForStaff(db, actor, id);
  const [[c], [d], interests, drives, acts, fus, notes, consultants] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, l.customerId)),
    db.select({ d: dealerships, brand: brands.name }).from(dealerships).innerJoin(brands, eq(brands.id, dealerships.brandId)).where(eq(dealerships.id, l.dealershipId)),
    db.select({ i: leadInterests, m: carModels }).from(leadInterests).innerJoin(carModels, eq(carModels.id, leadInterests.modelId)).where(eq(leadInterests.leadId, id)),
    db.select({ t: testDrives, model: carModels.name, consultant: users.name }).from(testDrives).innerJoin(carModels, eq(carModels.id, testDrives.modelId)).leftJoin(users, eq(users.id, testDrives.consultantId)).where(eq(testDrives.leadId, id)).orderBy(desc(testDrives.createdAt)),
    db.select({ a: leadActivities, userName: users.name }).from(leadActivities).leftJoin(users, eq(users.id, leadActivities.userId)).where(eq(leadActivities.leadId, id)).orderBy(desc(leadActivities.at)),
    db.select({ f: followUps, assignee: users.name }).from(followUps).leftJoin(users, eq(users.id, followUps.assignedToId)).where(eq(followUps.leadId, id)).orderBy(asc(followUps.dueAt)),
    db.select().from(notifications).where(eq(notifications.leadId, id)).orderBy(desc(notifications.createdAt)),
    consultantOptions(db, l.dealershipId),
  ]);
  const showContact = can(actor, "customers.contact");
  const catalogue = await catalogueForDealership(db, l.dealershipId).catch(() => []);
  return {
    lead: l,
    dealership: d.d,
    brand: d.brand,
    customer: {
      id: c.id, name: c.name, phone: showContact ? c.phone : null, email: showContact ? c.email : null, contactHidden: !showContact,
      consent: { whatsapp: c.consentWhatsapp, sms: c.consentSms, email: c.consentEmail, marketing: c.consentMarketing, optedOutAt: c.marketingOptOutAt },
      nurture: nurtureBlocker(l.status, c),
    },
    interests,
    drives,
    activities: acts,
    followUps: fus,
    notifications: notes,
    consultants,
    catalogue,
  };
}

export async function consultantOptions(db: DB, dealershipId: string) {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .innerJoin(userDealerships, eq(userDealerships.userId, users.id))
    .where(and(eq(userDealerships.dealershipId, dealershipId), eq(users.active, true), inArray(users.role, ["sales_consultant", "dealership_manager"])))
    .orderBy(asc(users.name));
}

export const staffLeadInput = contactInput.extend({
  dealershipId: z.string().uuid(),
  source: z.enum(LEAD_SOURCES).default("phone"),
  modelIds: z.array(z.string().uuid()).min(1, "Choose at least one model").max(5),
  timeframe: z.enum(TIMEFRAMES).nullable().optional(),
  budgetBand: z.enum(BUDGET_BANDS).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/** Enquiry taken by phone / web / referral (walk-ins go through captureVisit). */
export async function createLead(db: DB, actor: Actor, raw: z.input<typeof staffLeadInput>) {
  assertCan(actor, "leads.manage");
  const p = staffLeadInput.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues.map((i) => i.message));
  const input = p.data;
  assertDealership(actor, input.dealershipId);
  const dealer = await dealershipOr404(db, input.dealershipId);
  const models = await db.select().from(carModels).where(inArray(carModels.id, input.modelIds));
  if (models.length !== input.modelIds.length || models.some((m) => m.brandId !== dealer.brandId)) throw new ValidationError(["Choose models from this dealership’s brand"]);
  const now = new Date();
  const created = await db.transaction(async (t) => {
    const tx = txOf(t);
    const customer = await upsertCustomerByPhone(tx, actor.id, dealer, input);
    const [open] = await tx.select({ id: leads.id, leadNo: leads.leadNo }).from(leads).where(and(eq(leads.customerId, customer.id), eq(leads.dealershipId, dealer.id), eq(leads.status, "open"))).limit(1);
    if (open) throw new ConflictError(`This customer already has an open enquiry (${open.leadNo}). Add the models to it instead.`);
    const [bMin, bMax] = input.budgetBand ? BUDGET_RANGES[input.budgetBand] : [null, null];
    const [l] = await tx
      .insert(leads)
      .values({
        leadNo: await nextLeadNo(tx, dealer.code), dealershipId: dealer.id, customerId: customer.id, source: input.source,
        consultantId: actor.role === "sales_consultant" ? actor.id : null, timeframe: input.timeframe ?? null, budgetMin: bMin, budgetMax: bMax,
        nextFollowUpAt: defaultFollowUpAt("enquiry", now), createdById: actor.id, isDemo: dealer.isDemo,
      })
      .returning();
    for (const [i, m] of input.modelIds.entries()) await tx.insert(leadInterests).values({ leadId: l.id, modelId: m, isPrimary: i === 0 });
    await addActivity(tx, l.id, "created", `Enquiry recorded (${input.source.replace("_", " ")})${input.notes ? `: ${input.notes}` : ""}`, actor.id);
    await audit(tx, { userId: actor.id, action: "lead.create", entityType: "lead", entityId: l.id, dealershipId: dealer.id, after: { leadNo: l.leadNo, source: input.source } });
    return { l, customer };
  });
  try {
    await notify(db, { event: "enquiry_received", dealershipId: dealer.id, customerId: created.customer.id, leadId: created.l.id, context: { models: models.map((m) => m.name).join(", ") }, isDemo: dealer.isDemo });
  } catch (e) {
    console.error("[notify] enquiry", e);
  }
  return created.l;
}

export const leadUpdateInput = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  timeframe: z.enum(TIMEFRAMES).nullable().optional(),
  budgetMin: z.coerce.number().min(0).nullable().optional(),
  budgetMax: z.coerce.number().min(0).nullable().optional(),
  fuelPreference: z.string().trim().max(30).nullable().optional(),
  financeNeeded: z.boolean().nullable().optional(),
  exchangeVehicle: z.string().trim().max(120).nullable().optional(),
  nextFollowUpAt: z.union([z.coerce.date(), z.null()]).optional(),
});

export async function updateLead(db: DB, actor: Actor, id: string, raw: z.input<typeof leadUpdateInput>) {
  const l = await leadForStaff(db, actor, id, true);
  const p = leadUpdateInput.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const patch = p.data;
  if (l.status !== "open") throw new ValidationError(["Closed enquiries can’t be edited. Ask a manager to reopen it."]);
  if (patch.stage && patch.stage !== l.stage) {
    const err = canChangeStage(l.status, l.stage, patch.stage);
    if (err) throw new ValidationError([err]);
  } else delete patch.stage;
  if (patch.budgetMin != null && patch.budgetMax != null && patch.budgetMin > patch.budgetMax) throw new ValidationError(["Budget minimum is above the maximum"]);
  await db.transaction(async (t) => {
    const tx = txOf(t);
    await tx.update(leads).set({ ...patch, updatedAt: new Date(), version: sql`${leads.version} + 1` }).where(eq(leads.id, id));
    if (patch.stage) await addActivity(tx, id, "stage_change", `Stage: ${l.stage} → ${patch.stage}`, actor.id);
    await audit(tx, { userId: actor.id, action: "lead.update", entityType: "lead", entityId: id, dealershipId: l.dealershipId, after: patch });
  });
}

export async function assignLead(db: DB, actor: Actor, id: string, consultantId: string | null) {
  const l = await leadForStaff(db, actor, id, true);
  // Consultants may pick up an unassigned enquiry for themselves; reassigning needs leads.assign.
  const selfPickUp = !l.consultantId && consultantId === actor.id;
  if (!selfPickUp) assertCan(actor, "leads.assign");
  if (consultantId) {
    const ok = (await consultantOptions(db, l.dealershipId)).some((c) => c.id === consultantId);
    if (!ok) throw new ValidationError(["Choose a sales consultant or manager at this dealership"]);
  }
  await db.transaction(async (t) => {
    const tx = txOf(t);
    await tx.update(leads).set({ consultantId, updatedAt: new Date() }).where(eq(leads.id, id));
    await tx.update(followUps).set({ assignedToId: consultantId }).where(and(eq(followUps.leadId, id), eq(followUps.status, "open")));
    const [u] = consultantId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, consultantId)) : [{ name: "nobody" }];
    await addActivity(tx, id, "assignment", `Assigned to ${u.name}`, actor.id);
    await audit(tx, { userId: actor.id, action: "lead.assign", entityType: "lead", entityId: id, dealershipId: l.dealershipId, before: { consultantId: l.consultantId }, after: { consultantId } });
  });
}

export async function setLeadInterests(db: DB, actor: Actor, id: string, modelIds: string[]) {
  const l = await leadForStaff(db, actor, id, true);
  if (l.status !== "open") throw new ValidationError(["Closed enquiries can’t be edited"]);
  if (!modelIds.length) throw new ValidationError(["Keep at least one model of interest"]);
  const [d] = await db.select().from(dealerships).where(eq(dealerships.id, l.dealershipId));
  const ms = await db.select().from(carModels).where(inArray(carModels.id, modelIds));
  if (ms.length !== modelIds.length || ms.some((m) => m.brandId !== d.brandId)) throw new ValidationError(["Choose models from this dealership’s brand"]);
  await db.transaction(async (t) => {
    const tx = txOf(t);
    await tx.delete(leadInterests).where(eq(leadInterests.leadId, id));
    for (const [i, m] of modelIds.entries()) await tx.insert(leadInterests).values({ leadId: id, modelId: m, isPrimary: i === 0 });
    await addActivity(tx, id, "note", `Models of interest: ${ms.map((m) => m.name).join(", ")}`, actor.id);
  });
}

export async function logContact(db: DB, actor: Actor, id: string, input: { type: "call" | "visit" | "message" | "note"; text: string; nextFollowUpAt?: Date | null }) {
  const l = await leadForStaff(db, actor, id, true);
  if (!input.text?.trim()) throw new ValidationError(["Describe the conversation or note"]);
  const now = new Date();
  await db.transaction(async (t) => {
    const tx = txOf(t);
    await addActivity(tx, id, input.type, input.text.trim().slice(0, 2000), actor.id, now);
    const patch: Partial<typeof leads.$inferInsert> = { updatedAt: now };
    if (input.type !== "note") patch.lastContactAt = now;
    if (input.nextFollowUpAt !== undefined && l.status === "open") patch.nextFollowUpAt = input.nextFollowUpAt;
    await tx.update(leads).set(patch).where(eq(leads.id, id));
  });
}

/* ───── Test drives ───── */

export async function requestTestDrive(db: DB, actor: Actor, leadId: string, modelId: string, scheduledAt: Date | null) {
  const l = await leadForStaff(db, actor, leadId, true);
  if (l.status !== "open") throw new ValidationError(["Enquiry is closed"]);
  const [m] = await db.select().from(carModels).where(eq(carModels.id, modelId));
  const [d] = await db.select().from(dealerships).where(eq(dealerships.id, l.dealershipId));
  if (!m || m.brandId !== d.brandId) throw new ValidationError(["Choose a model from this dealership’s range"]);
  if (scheduledAt && scheduledAt.getTime() < Date.now() - 15 * 60_000) throw new ValidationError(["Schedule time is in the past"]);
  const [td] = await db.insert(testDrives).values({ leadId, modelId, status: scheduledAt ? "scheduled" : "requested", scheduledAt, consultantId: l.consultantId ?? (actor.role === "sales_consultant" ? actor.id : null) }).returning();
  await addActivity(db, leadId, "test_drive", `Test drive ${scheduledAt ? "scheduled" : "requested"}: ${m.name}`, actor.id);
  return td;
}

export async function completeTestDrive(db: DB, actor: Actor, testDriveId: string, input: { licenceChecked: boolean; rating?: number | null; notes?: string | null }, at?: Date) {
  const [td] = await db.select().from(testDrives).where(eq(testDrives.id, testDriveId));
  if (!td) throw new NotFoundError("Test drive not found");
  const l = await leadForStaff(db, actor, td.leadId, true);
  if (td.status === "completed" || td.status === "cancelled") throw new ValidationError([`Test drive is already ${td.status}`]);
  if (!input.licenceChecked) throw new ValidationError(["Confirm you checked the customer’s driving licence"]);
  if (input.rating != null && !(input.rating >= 1 && input.rating <= 5)) throw new ValidationError(["Rating must be 1–5"]);
  const now = at ?? new Date();
  await db.transaction(async (t) => {
    const tx = txOf(t);
    await tx.update(testDrives).set({ status: "completed", completedAt: now, licenceChecked: true, rating: input.rating ?? null, notes: input.notes?.trim() || null, consultantId: td.consultantId ?? actor.id }).where(eq(testDrives.id, testDriveId));
    const patch: Partial<typeof leads.$inferInsert> = { lastContactAt: now, updatedAt: now, nextFollowUpAt: defaultFollowUpAt("test_drive", now) };
    if (l.status === "open" && l.stage === "enquiry") patch.stage = "test_drive";
    await tx.update(leads).set(patch).where(eq(leads.id, l.id));
    const [m] = await tx.select({ name: carModels.name }).from(carModels).where(eq(carModels.id, td.modelId));
    await addActivity(tx, l.id, "test_drive", `Test drive completed: ${m.name}${input.rating ? ` (rated ${input.rating}/5)` : ""}${input.notes ? `. ${input.notes}` : ""}`, actor.id, now);
  });
}

export async function cancelTestDrive(db: DB, actor: Actor, testDriveId: string) {
  const [td] = await db.select().from(testDrives).where(eq(testDrives.id, testDriveId));
  if (!td) throw new NotFoundError();
  await leadForStaff(db, actor, td.leadId, true);
  if (td.status === "completed") throw new ValidationError(["Completed test drives can’t be cancelled"]);
  await db.update(testDrives).set({ status: "cancelled" }).where(eq(testDrives.id, testDriveId));
  await addActivity(db, td.leadId, "test_drive", "Test drive cancelled", actor.id);
}

/* ───── Follow-ups ───── */

export async function addFollowUp(db: DB, actor: Actor, leadId: string, input: { dueAt: Date; kind: "call" | "message" | "visit"; reason: string }) {
  const l = await leadForStaff(db, actor, leadId, true);
  if (l.status !== "open") throw new ValidationError(["Enquiry is closed"]);
  if (!input.reason?.trim()) throw new ValidationError(["Add a reason for the follow-up"]);
  if (!(input.dueAt instanceof Date) || isNaN(input.dueAt.getTime())) throw new ValidationError(["Choose a due date"]);
  const [f] = await db.insert(followUps).values({ leadId, assignedToId: l.consultantId ?? actor.id, dueAt: input.dueAt, kind: input.kind, reason: input.reason.trim() }).returning();
  await db.update(leads).set({ nextFollowUpAt: earliest(l.nextFollowUpAt, input.dueAt), updatedAt: new Date() }).where(eq(leads.id, leadId));
  return f;
}

export async function completeFollowUp(db: DB, actor: Actor, followUpId: string, input: { status: "done" | "skipped"; outcomeNote: string }) {
  const [f] = await db.select().from(followUps).where(eq(followUps.id, followUpId));
  if (!f) throw new NotFoundError();
  const l = await leadForStaff(db, actor, f.leadId, true);
  if (f.status !== "open") throw new ValidationError(["Follow-up is already closed"]);
  if (!input.outcomeNote?.trim()) throw new ValidationError(["Note what happened"]);
  const now = new Date();
  await db.transaction(async (t) => {
    const tx = txOf(t);
    await tx.update(followUps).set({ status: input.status, completedAt: now, completedById: actor.id, outcomeNote: input.outcomeNote.trim() }).where(eq(followUps.id, followUpId));
    await addActivity(tx, l.id, "follow_up", `${input.status === "done" ? "Follow-up done" : "Follow-up skipped"}: ${f.reason}. ${input.outcomeNote.trim()}`, actor.id, now);
    const [next] = await tx.select({ dueAt: followUps.dueAt }).from(followUps).where(and(eq(followUps.leadId, l.id), eq(followUps.status, "open"))).orderBy(asc(followUps.dueAt)).limit(1);
    await tx.update(leads).set({ lastContactAt: input.status === "done" ? now : l.lastContactAt, nextFollowUpAt: next?.dueAt ?? null, updatedAt: now }).where(eq(leads.id, l.id));
  });
}

function earliest(a: Date | null, b: Date) {
  return a && a < b ? a : b;
}

export async function myFollowUps(db: DB, actor: Actor, opts: { includeFuture?: boolean } = {}) {
  assertCan(actor, "leads.view");
  const scope = dealershipScope(actor);
  const conds: (SQL | undefined)[] = [eq(followUps.status, "open"), eq(leads.status, "open"), demoFilter(leads.isDemo)];
  if (actor.role === "sales_consultant") conds.push(eq(followUps.assignedToId, actor.id));
  if (scope !== "all") conds.push(scope.length ? inArray(leads.dealershipId, scope) : sql`false`);
  if (!opts.includeFuture) conds.push(lt(followUps.dueAt, new Date(Date.now() + 24 * 3_600_000)));
  return db
    .select({ f: followUps, leadNo: leads.leadNo, leadId: leads.id, customerName: customers.name, assignee: users.name })
    .from(followUps)
    .innerJoin(leads, eq(leads.id, followUps.leadId))
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .leftJoin(users, eq(users.id, followUps.assignedToId))
    .where(and(...conds))
    .orderBy(asc(followUps.dueAt))
    .limit(200);
}

/* ───── Outcomes ───── */

export async function closeLead(db: DB, actor: Actor, id: string, input: CloseInput) {
  const l = await leadForStaff(db, actor, id, true);
  const errs = validateClose(l.status, input);
  if (errs.length) throw new ValidationError(errs);
  const now = new Date();
  await db.transaction(async (t) => {
    const tx = txOf(t);
    await tx
      .update(leads)
      .set({
        status: input.status, closedAt: now, nextFollowUpAt: null, updatedAt: now,
        closeReason: input.reason?.trim() || null, lostToBrand: input.lostToBrand?.trim() || null, lostToModel: input.lostToModel?.trim() || null,
        lostToDealer: input.lostToDealer?.trim() || null, wonInvoiceRef: input.wonInvoiceRef?.trim() || null,
        stage: input.status === "won" ? "booked" : l.stage,
      })
      .where(eq(leads.id, id));
    // Closing stops nurture: cancel open follow-ups.
    await tx.update(followUps).set({ status: "skipped", completedAt: now, completedById: actor.id, outcomeNote: "Enquiry closed" }).where(and(eq(followUps.leadId, id), eq(followUps.status, "open")));
    if (input.status === "opted_out") {
      await tx.update(customers).set({ marketingOptOutAt: now, consentMarketing: false }).where(eq(customers.id, l.customerId));
    }
    const detail =
      input.status === "lost_other_dealer" ? `Bought elsewhere: ${[input.lostToBrand, input.lostToModel].filter(Boolean).join(" ")}${input.lostToDealer ? ` at ${input.lostToDealer}` : ""}`
      : input.status === "not_interested" ? `Not interested: ${input.reason}`
      : input.status === "opted_out" ? "Customer asked not to be contacted — marketing opt-out recorded"
      : `Sale won${input.wonInvoiceRef ? ` (${input.wonInvoiceRef})` : ""}`;
    await addActivity(tx, id, "outcome", detail + (input.reason && input.status !== "not_interested" ? `. ${input.reason}` : ""), actor.id, now);
    await audit(tx, { userId: actor.id, action: "lead.close", entityType: "lead", entityId: id, dealershipId: l.dealershipId, before: { status: l.status }, after: input });
  });
}

export async function reopenLead(db: DB, actor: Actor, id: string, reason: string) {
  const l = await leadForStaff(db, actor, id, true);
  assertCan(actor, "leads.assign");
  if (l.status === "open") throw new ValidationError(["Enquiry is already open"]);
  if (l.status === "opted_out") throw new ValidationError(["The customer opted out. Record a new enquiry only if they contact you again."]);
  if (!reason?.trim()) throw new ValidationError(["Give a reason for reopening"]);
  await db.transaction(async (t) => {
    const tx = txOf(t);
    await tx.update(leads).set({ status: "open", closedAt: null, nextFollowUpAt: defaultFollowUpAt("enquiry", new Date()), updatedAt: new Date() }).where(eq(leads.id, id));
    await addActivity(tx, id, "outcome", `Reopened: ${reason.trim()}`, actor.id);
    await audit(tx, { userId: actor.id, action: "lead.reopen", entityType: "lead", entityId: id, dealershipId: l.dealershipId, before: { status: l.status }, after: { status: "open", reason } });
  });
}

/* ───────────────────────── Nurture: model updates ───────────────────────── */

export const modelUpdateInput = z.object({
  modelId: z.string().uuid(),
  dealershipId: z.string().uuid().nullable().optional(),
  type: z.enum(MODEL_UPDATE_TYPES),
  title: z.string().trim().min(3, "Add a short title").max(80),
  message: z.string().trim().min(10, "Write the message customers will receive").max(500),
  validUntil: z.string().refine(isIsoDate, "Invalid date").nullable().optional(),
  includeProspects: z.boolean().default(false),
});

/** Which dealerships an update reaches: the chosen one, or every in-scope dealership of the model's brand. */
async function updateDealerships(db: DB, actor: Actor, modelId: string, dealershipId: string | null | undefined) {
  const [m] = await db.select().from(carModels).where(eq(carModels.id, modelId));
  if (!m) throw new ValidationError(["Model not found"]);
  const scope = dealershipScope(actor);
  const ds = await db.select().from(dealerships).where(and(eq(dealerships.brandId, m.brandId), eq(dealerships.active, true), demoFilter(dealerships.isDemo)));
  let ids = ds.map((d) => d.id).filter((id) => scope === "all" || scope.includes(id));
  if (dealershipId) {
    if (!ids.includes(dealershipId)) throw new ForbiddenError("That dealership is outside your scope or doesn’t sell this model");
    ids = [dealershipId];
  }
  if (!ids.length) throw new ValidationError(["No dealership in your scope sells this model"]);
  return { model: m, dealershipIds: ids };
}

export interface Audience {
  eligible: { leadId: string; customerId: string; dealershipId: string; consultantId: string | null }[];
  skipped: Record<NurtureSkip, number>;
  prospects: { feedbackId: string; customerId: string; dealershipId: string }[];
  prospectsSkipped: number;
}

export async function nurtureAudience(db: DB, actor: Actor, raw: { modelId: string; dealershipId?: string | null; includeProspects?: boolean }): Promise<Audience> {
  assertCan(actor, "model_updates.manage");
  const { dealershipIds } = await updateDealerships(db, actor, raw.modelId, raw.dealershipId);
  const rows = await db
    .select({ l: leads, c: customers })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .innerJoin(leadInterests, and(eq(leadInterests.leadId, leads.id), eq(leadInterests.modelId, raw.modelId)))
    .where(and(inArray(leads.dealershipId, dealershipIds), eq(leads.status, "open"), demoFilter(leads.isDemo)));
  const skipped: Record<NurtureSkip, number> = { closed: 0, no_marketing_consent: 0, opted_out: 0, no_channel: 0 };
  const eligible: Audience["eligible"] = [];
  for (const { l, c } of rows) {
    const b = nurtureBlocker(l.status, c);
    if (b) skipped[b]++;
    else eligible.push({ leadId: l.id, customerId: c.id, dealershipId: l.dealershipId, consultantId: l.consultantId });
  }
  const prospects: Audience["prospects"] = [];
  let prospectsSkipped = 0;
  if (raw.includeProspects) {
    const scope = dealershipScope(actor);
    const fbs = await db
      .select({ f: loungeFeedback, c: customers })
      .from(loungeFeedback)
      .innerJoin(customers, eq(customers.id, loungeFeedback.customerId))
      .where(and(sql`${loungeFeedback.preferredModelIds} @> ${JSON.stringify([raw.modelId])}::jsonb`, demoFilter(loungeFeedback.isDemo), scope === "all" ? undefined : scope.length ? inArray(loungeFeedback.dealershipId, scope) : sql`false`));
    const already = new Set(eligible.map((e) => e.customerId));
    for (const { f, c } of fbs) {
      if (already.has(c.id)) continue; // already reached through an open enquiry
      if (!prospectMatchesModel({ ...f, preferredModelIds: f.preferredModelIds ?? [] }, raw.modelId)) continue;
      if (!hasMarketingPermission(c)) {
        prospectsSkipped++;
        continue;
      }
      already.add(c.id);
      prospects.push({ feedbackId: f.id, customerId: c.id, dealershipId: dealershipIds.includes(f.dealershipId) ? f.dealershipId : dealershipIds[0] });
    }
  }
  return { eligible, skipped, prospects, prospectsSkipped };
}

/** Publish: message every eligible open enquiry (+ matching prospects), and create a call task per enquiry. */
export async function publishModelUpdate(db: DB, actor: Actor, raw: z.input<typeof modelUpdateInput>, opts: { at?: Date } = {}) {
  assertCan(actor, "model_updates.manage");
  const p = modelUpdateInput.safeParse(raw);
  if (!p.success) throw new ValidationError(p.error.issues.map((i) => i.message));
  const input = p.data;
  const { model } = await updateDealerships(db, actor, input.modelId, input.dealershipId);
  const audience = await nurtureAudience(db, actor, input);
  const now = opts.at ?? new Date();
  const [upd] = await db
    .insert(modelUpdates)
    .values({
      modelId: input.modelId, dealershipId: input.dealershipId ?? null, type: input.type, title: input.title, message: input.message,
      validUntil: input.validUntil ?? null, includeProspects: input.includeProspects, status: "published", publishedAt: now, createdById: actor.id,
      recipients: audience.eligible.length + audience.prospects.length, tasksCreated: audience.eligible.length, isDemo: model.isDemo,
    })
    .returning();
  const ctx = { models: model.name, updateTitle: input.title, updateMessage: input.message, validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null };
  for (const e of audience.eligible) {
    try {
      await notify(db, { event: "model_update", dealershipId: e.dealershipId, customerId: e.customerId, leadId: e.leadId, variant: upd.id, context: ctx, isDemo: model.isDemo });
    } catch (err) {
      console.error("[notify] model update", err);
    }
    await db.insert(followUps).values({ leadId: e.leadId, assignedToId: e.consultantId, dueAt: defaultFollowUpAt("model_update", now), kind: "call", reason: `Call about: ${input.title} (${model.name})`, modelUpdateId: upd.id });
    await addActivity(db, e.leadId, "nurture", `Update sent: ${input.title}`, actor.id, now);
    await db.update(leads).set({ nextFollowUpAt: sql`least(coalesce(${leads.nextFollowUpAt}, ${defaultFollowUpAt("model_update", now)}::timestamptz), ${defaultFollowUpAt("model_update", now)}::timestamptz)` }).where(eq(leads.id, e.leadId));
  }
  for (const pr of audience.prospects) {
    try {
      await notify(db, { event: "model_update", dealershipId: pr.dealershipId, customerId: pr.customerId, variant: `${upd.id}:${pr.feedbackId}`, context: ctx, isDemo: model.isDemo });
    } catch (err) {
      console.error("[notify] prospect update", err);
    }
  }
  await audit(db, { userId: actor.id, action: "model_update.publish", entityType: "model_update", entityId: upd.id, after: { ...input, recipients: upd.recipients, skipped: audience.skipped } });
  return { update: upd, sent: audience.eligible.length, prospects: audience.prospects.length, skipped: audience.skipped, prospectsSkipped: audience.prospectsSkipped };
}

export async function listModelUpdates(db: DB, actor: Actor) {
  assertCan(actor, "leads.view");
  return db
    .select({ u: modelUpdates, model: carModels.name, brand: brands.name, by: users.name, dealershipName: dealerships.name })
    .from(modelUpdates)
    .innerJoin(carModels, eq(carModels.id, modelUpdates.modelId))
    .innerJoin(brands, eq(brands.id, carModels.brandId))
    .leftJoin(users, eq(users.id, modelUpdates.createdById))
    .leftJoin(dealerships, eq(dealerships.id, modelUpdates.dealershipId))
    .where(demoFilter(modelUpdates.isDemo))
    .orderBy(desc(modelUpdates.createdAt))
    .limit(100);
}

/* ───────────────────────── Future prospects (lounge feedback) ───────────────────────── */

export interface ProspectFilters {
  upgradeOnly?: boolean; // owned 5+ years
  interest?: "yes" | "maybe" | "no";
  timeframe?: string;
  budgetBand?: string;
  status?: "new" | "contacted" | "converted" | "not_now" | "all";
  modelId?: string;
}

export async function listProspects(db: DB, actor: Actor, f: ProspectFilters = {}) {
  assertCan(actor, "prospects.view");
  const scope = dealershipScope(actor);
  const conds: (SQL | undefined)[] = [demoFilter(loungeFeedback.isDemo)];
  if (scope !== "all") conds.push(scope.length ? inArray(loungeFeedback.dealershipId, scope) : sql`false`);
  if (f.interest) conds.push(eq(loungeFeedback.interest, f.interest));
  if (f.timeframe) conds.push(eq(loungeFeedback.timeframe, f.timeframe as never));
  if (f.budgetBand) conds.push(eq(loungeFeedback.budgetBand, f.budgetBand as never));
  if (f.status && f.status !== "all") conds.push(eq(loungeFeedback.status, f.status));
  if (!f.status) conds.push(inArray(loungeFeedback.status, ["new", "contacted"]));
  if (f.modelId) conds.push(sql`${loungeFeedback.preferredModelIds} @> ${JSON.stringify([f.modelId])}::jsonb`);
  const today = businessDate();
  if (f.upgradeOnly) conds.push(lte(loungeFeedback.purchaseYear, Number(today.slice(0, 4)) - 5));
  const rows = await db
    .select({ f: loungeFeedback, customerName: customers.name, phone: customers.phone, consentMarketing: customers.consentMarketing, optedOut: customers.marketingOptOutAt, dealershipName: dealerships.name })
    .from(loungeFeedback)
    .innerJoin(customers, eq(customers.id, loungeFeedback.customerId))
    .innerJoin(dealerships, eq(dealerships.id, loungeFeedback.dealershipId))
    .where(and(...conds))
    .orderBy(desc(loungeFeedback.createdAt))
    .limit(500);
  const allModelIds = [...new Set(rows.flatMap((r) => r.f.preferredModelIds ?? []))];
  const ms = allModelIds.length ? await db.select({ id: carModels.id, name: carModels.name, brand: brands.name }).from(carModels).innerJoin(brands, eq(brands.id, carModels.brandId)).where(inArray(carModels.id, allModelIds)) : [];
  const showContact = can(actor, "customers.contact");
  return rows
    .map((r) => ({
      ...r,
      phone: showContact ? r.phone : null,
      upgradeCandidate: isUpgradeCandidate(r.f.purchaseYear, today),
      score: prospectScore({ interest: r.f.interest, timeframe: r.f.timeframe, purchaseYear: r.f.purchaseYear }, today),
      preferredModels: (r.f.preferredModelIds ?? []).map((id) => ms.find((m) => m.id === id)).filter(Boolean) as { id: string; name: string; brand: string }[],
      canNurture: !!r.consentMarketing && !r.optedOut,
    }))
    .sort((a, b) => b.score - a.score);
}

export async function setProspectStatus(db: DB, actor: Actor, id: string, status: "contacted" | "not_now" | "new") {
  assertCan(actor, "leads.manage");
  const [f] = await db.select().from(loungeFeedback).where(eq(loungeFeedback.id, id));
  if (!f) throw new NotFoundError();
  assertDealership(actor, f.dealershipId);
  if (f.status === "converted") throw new ValidationError(["Already converted to an enquiry"]);
  await db.update(loungeFeedback).set({ status }).where(eq(loungeFeedback.id, id));
  await audit(db, { userId: actor.id, action: "prospect.status", entityType: "lounge_feedback", entityId: id, dealershipId: f.dealershipId, before: { status: f.status }, after: { status } });
}

/** Turn a lounge prospect into an open enquiry at a chosen sales dealership (may be a different brand). */
export async function convertProspect(db: DB, actor: Actor, id: string, targetDealershipId: string) {
  assertCan(actor, "leads.manage");
  const [f] = await db.select().from(loungeFeedback).where(eq(loungeFeedback.id, id));
  if (!f || (DATA_MODE === "live" && f.isDemo)) throw new NotFoundError();
  if (!canAccessDealership(actor, f.dealershipId) && !canAccessDealership(actor, targetDealershipId)) throw new ForbiddenError();
  assertDealership(actor, targetDealershipId);
  if (f.status === "converted") throw new ConflictError("Already converted to an enquiry");
  const target = await dealershipOr404(db, targetDealershipId);
  if (!target.hasSales) throw new ValidationError(["Choose a dealership that sells new cars"]);
  const [c] = await db.select().from(customers).where(eq(customers.id, f.customerId));
  const ms = f.preferredModelIds?.length ? await db.select().from(carModels).where(and(inArray(carModels.id, f.preferredModelIds), eq(carModels.brandId, target.brandId))) : [];
  const budget = f.budgetBand ? BUDGET_RANGES[f.budgetBand] : [null, null];
  return db.transaction(async (t) => {
    const tx = txOf(t);
    // Customers belong to a legal entity; reuse or create the customer under the target entity.
    let customerId = c.id;
    if (c.legalEntityId !== target.legalEntityId) {
      const [ex] = c.phone ? await tx.select().from(customers).where(and(eq(customers.phone, c.phone), eq(customers.legalEntityId, target.legalEntityId))).limit(1) : [];
      if (ex) customerId = ex.id;
      else {
        const { id: _i, createdAt: _c, legalEntityId: _l, dealershipId: _d, ...rest } = c;
        const [nc] = await tx.insert(customers).values({ ...rest, legalEntityId: target.legalEntityId, dealershipId: target.id }).returning();
        customerId = nc.id;
      }
    }
    const [open] = await tx.select().from(leads).where(and(eq(leads.customerId, customerId), eq(leads.dealershipId, target.id), eq(leads.status, "open"))).limit(1);
    let leadId = open?.id;
    if (!open) {
      const [l] = await tx
        .insert(leads)
        .values({
          leadNo: await nextLeadNo(tx, target.code), dealershipId: target.id, customerId, source: "lounge_feedback",
          consultantId: actor.role === "sales_consultant" && actor.dealershipIds.includes(target.id) ? actor.id : null,
          timeframe: f.timeframe === "not_planning" ? null : f.timeframe, budgetMin: budget[0], budgetMax: budget[1], fuelPreference: f.preferredFuel,
          exchangeVehicle: [f.currentMake, f.currentModel, f.purchaseYear].filter(Boolean).join(" ") || null,
          nextFollowUpAt: defaultFollowUpAt("enquiry", new Date()), createdById: actor.id, isDemo: f.isDemo,
        })
        .returning();
      leadId = l.id;
      await addActivity(tx, l.id, "created", `Converted from lounge feedback (${f.interest === "yes" ? "interested" : "maybe"}, ${f.timeframe ?? "no timeframe"})${f.otherPreferences ? `. Preferences: ${f.otherPreferences}` : ""}`, actor.id);
    } else {
      await addActivity(tx, open.id, "note", "Lounge feedback linked to this open enquiry", actor.id);
    }
    for (const [i, m] of ms.entries()) await tx.insert(leadInterests).values({ leadId: leadId!, modelId: m.id, isPrimary: i === 0 && !open }).onConflictDoNothing();
    await tx.update(loungeFeedback).set({ status: "converted", convertedLeadId: leadId }).where(eq(loungeFeedback.id, id));
    await audit(tx, { userId: actor.id, action: "prospect.convert", entityType: "lounge_feedback", entityId: id, dealershipId: target.id, after: { leadId } });
    return leadId!;
  });
}

export async function salesDealerships(db: DB, actor: Actor) {
  const scope = dealershipScope(actor);
  return db
    .select({ id: dealerships.id, name: dealerships.name, brandId: dealerships.brandId })
    .from(dealerships)
    .where(and(eq(dealerships.active, true), eq(dealerships.hasSales, true), demoFilter(dealerships.isDemo), scope === "all" ? undefined : scope.length ? inArray(dealerships.id, scope) : sql`false`))
    .orderBy(asc(dealerships.name));
}


