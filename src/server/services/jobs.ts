import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import {
  jobs, jobEvents, jobChecklistItems, jobParts, jobPhotos, labourLogs, customers, vehicles, dealerships, users, userDealerships,
  workflowStages, notifications, BLOCKERS, PAYMENT_STATUSES, type JobType, type Blocker,
} from "@/db/schema";
import {
  checkTransition, effectsOfEntering, resolveStages, sortStages, type StageDef, type CommonStage, WORK_STAGES,
} from "@/domain/workflow";
import { assertCan, assertDealership, can, canMoveJob, canViewJob, ForbiddenError, dealershipScope } from "@/domain/permissions";
import { isCustomerFacingDelay } from "@/domain/notifications";
import { businessDate, addDays, zonedMidnight } from "@/domain/periods";

const LABOUR_BACKDATE_DAYS = 7;
import type { Actor } from "../principal";
import { audit, diff } from "../audit";
import { notify, type NotifyRequest } from "../notify/dispatcher";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { demoFilter, DATA_MODE } from "../data-mode";
import { saveUpload } from "../storage";

export const SERVICE_CHECKLIST = [
  "Exterior body condition", "Tyres & wheels", "Lights & indicators", "Brakes", "Fluids (engine oil, coolant, brake)",
  "Battery", "Wipers & washers", "Interior & dashboard warning lights", "Valuables / accessories noted",
];
export const BODYSHOP_CHECKLIST = [
  "Damage photographed from all sides", "Panels affected noted", "Glass & lights checked", "Interior condition noted",
  "Insurance documents received", "Valuables / accessories noted",
];

/* ───────────────────────── Helpers ───────────────────────── */

export async function getStages(db: DB, dealershipId: string, jobType: JobType): Promise<StageDef[]> {
  const rows = await db
    .select()
    .from(workflowStages)
    .where(and(eq(workflowStages.jobType, jobType), or(eq(workflowStages.dealershipId, dealershipId), sql`${workflowStages.dealershipId} is null`)));
  return resolveStages(
    rows.map((r) => ({ ...r, commonStage: r.commonStage as CommonStage })),
    dealershipId,
  ).map(({ code, label, commonStage, sequence }) => ({ code, label, commonStage, sequence }));
}

export function normaliseReg(reg: string): string {
  return reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function normalisePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = p.replace(/[^\d+]/g, "");
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  return digits || null;
}

async function loadJobForWrite(db: DB, actor: Actor, jobId: string) {
  const [j] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!j || (DATA_MODE === "live" && j.isDemo)) throw new NotFoundError("Job not found");
  if (!canViewJob(actor, j)) throw new ForbiddenError("This job is outside your access scope");
  return j;
}

async function bumpVersion(tx: DB, jobId: string, expectedVersion: number | undefined, patch: Partial<typeof jobs.$inferInsert>) {
  const where = expectedVersion != null ? and(eq(jobs.id, jobId), eq(jobs.version, expectedVersion)) : eq(jobs.id, jobId);
  const res = await tx
    .update(jobs)
    .set({ ...patch, version: sql`${jobs.version} + 1`, updatedAt: new Date() })
    .where(where)
    .returning();
  if (!res.length) throw new ConflictError("This job was changed by someone else. Refresh to see the latest version.");
  return res[0];
}

/** Next job number for a dealership/type/month: highest existing sequence + 1 (gaps are fine). */
async function nextJobNo(db: DB, dealerCode: string, jobType: JobType): Promise<string> {
  const prefix = `${jobType === "service" ? "SVC" : "BSH"}-${dealerCode}-${businessDate().slice(2, 7).replace("-", "")}-`;
  const [{ n }] = await db
    .select({ n: sql<number>`coalesce(max(nullif(regexp_replace(substring(${jobs.jobNo} from ${prefix.length + 1}::int), '[^0-9]', '', 'g'), '')::int), 0)` })
    .from(jobs)
    .where(sql`${jobs.jobNo} like ${prefix + "%"}`);
  return `${prefix}${String(Number(n) + 1).padStart(4, "0")}`;
}

function isUniqueViolation(e: unknown, constraint: string): boolean {
  const c = (e as { cause?: { code?: string; constraint?: string; detail?: string } })?.cause ?? (e as { code?: string; detail?: string });
  return c?.code === "23505" && (`${(c as { constraint?: string }).constraint ?? ""}${c.detail ?? ""}`.includes(constraint));
}

function contextFor(job: typeof jobs.$inferSelect, reg: string) {
  return { jobNo: job.jobNo, registrationNo: reg, estimateAmount: job.estimateAmount, expectedAt: job.expectedCompletionAt ?? job.promisedAt };
}

async function fireAll(db: DB, reqs: NotifyRequest[]) {
  for (const r of reqs) {
    try {
      await notify(db, r);
    } catch (e) {
      console.error("[notify] failed to record notification", e);
    }
  }
}

/* ───────────────────────── Customers & vehicles (duplicate-safe) ───────────────────────── */

export const customerVehicleInput = z.object({
  customerName: z.string().trim().min(2, "Customer name is required"),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().email("Invalid email").optional().nullable().or(z.literal("")),
  preferredChannel: z.enum(["whatsapp", "sms", "email"]).optional().nullable(),
  consentWhatsapp: z.boolean().default(false),
  consentSms: z.boolean().default(false),
  consentEmail: z.boolean().default(false),
  registrationNo: z.string().trim().min(4, "Registration number is required"),
  make: z.string().trim().optional().nullable(),
  model: z.string().trim().optional().nullable(),
  vin: z.string().trim().optional().nullable(),
});
export type CustomerVehicleInput = z.infer<typeof customerVehicleInput>;

/**
 * Re-uses an existing vehicle (by normalised registration) or customer (by phone) within the same
 * legal entity, so repeat visits do not create duplicates.
 */
export async function findOrCreateCustomerVehicle(tx: DB, actor: Actor, dealership: typeof dealerships.$inferSelect, input: CustomerVehicleInput, isDemoIn?: boolean) {
  const isDemo = isDemoIn ?? dealership.isDemo; // records at a demo dealership are demo records
  const reg = normaliseReg(input.registrationNo);
  const phone = normalisePhone(input.phone);
  const [existingVehicle] = await tx
    .select({ v: vehicles, c: customers })
    .from(vehicles)
    .innerJoin(customers, eq(customers.id, vehicles.customerId))
    .where(and(eq(vehicles.registrationNo, reg), eq(customers.legalEntityId, dealership.legalEntityId)))
    .limit(1);
  if (existingVehicle) return { customer: existingVehicle.c, vehicle: existingVehicle.v, reused: true };

  let [customer] = phone
    ? await tx.select().from(customers).where(and(eq(customers.phone, phone), eq(customers.legalEntityId, dealership.legalEntityId))).limit(1)
    : [];
  const anyConsent = input.consentWhatsapp || input.consentSms || input.consentEmail;
  if (!customer) {
    [customer] = await tx
      .insert(customers)
      .values({
        legalEntityId: dealership.legalEntityId,
        dealershipId: dealership.id,
        name: input.customerName,
        phone,
        email: input.email || null,
        preferredChannel: input.preferredChannel ?? null,
        consentWhatsapp: input.consentWhatsapp,
        consentSms: input.consentSms,
        consentEmail: input.consentEmail,
        consentRecordedAt: anyConsent ? new Date() : null,
        isDemo,
      })
      .returning();
    await audit(tx, { userId: actor.id, action: "customer.create", entityType: "customer", entityId: customer.id, dealershipId: dealership.id, after: { name: customer.name, consent: { whatsapp: input.consentWhatsapp, sms: input.consentSms, email: input.consentEmail } } });
  }
  const [vehicle] = await tx
    .insert(vehicles)
    .values({ customerId: customer.id, registrationNo: reg, make: input.make || null, model: input.model || null, vin: input.vin || null, isDemo })
    .returning();
  return { customer, vehicle, reused: false };
}

/* ───────────────────────── Create ───────────────────────── */

export const createJobInput = customerVehicleInput.extend({
  dealershipId: z.string().uuid(),
  jobType: z.enum(["service", "bodyshop"]),
  source: z.enum(["appointment", "walk_in"]).default("walk_in"),
  appointmentId: z.string().uuid().optional().nullable(),
  complaint: z.string().trim().min(3, "Describe the customer complaint / requested work"),
  odometerKm: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
  promisedAt: z.coerce.date().optional().nullable(),
  estimateAmount: z.coerce.number().min(0).optional().nullable(),
  insurerName: z.string().trim().optional().nullable(),
  claimRef: z.string().trim().optional().nullable(),
});
export type CreateJobInput = z.input<typeof createJobInput>;

export async function createJob(db: DB, actor: Actor, raw: CreateJobInput, opts: { isDemo?: boolean; openedAt?: Date } = {}) {
  assertCan(actor, "jobs.create");
  const parsed = createJobInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message));
  const input = parsed.data;
  assertDealership(actor, input.dealershipId);

  const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, input.dealershipId)).limit(1);
  if (!dealer || !dealer.active) throw new ValidationError(["Dealership not found or inactive"]);
  if (input.jobType === "bodyshop" && !dealer.hasBodyShop) throw new ValidationError([`${dealer.name} is not configured with a body shop`]);
  if (input.jobType === "service" && !dealer.hasService) throw new ValidationError([`${dealer.name} is not configured with a service workshop`]);

  const stages = await getStages(db, dealer.id, input.jobType);
  if (!stages.length) throw new ValidationError(["No workflow stages configured"]);
  opts = { ...opts, isDemo: opts.isDemo ?? dealer.isDemo };
  const first = stages[0];

  // Retry if two people open a job card at the same moment and get the same job number.
  let result: { job: typeof jobs.$inferSelect; vehicle: typeof vehicles.$inferSelect } | undefined;
  for (let attempt = 0; attempt < 5 && !result; attempt++) {
    try {
      result = await createJobTx();
    } catch (e) {
      if (!isUniqueViolation(e, "job_no") || attempt === 4) throw e;
    }
  }
  if (!result) throw new ConflictError("Could not allocate a job number; try again");
  const created = result;

  async function createJobTx() {
   return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    const { customer, vehicle } = await findOrCreateCustomerVehicle(tx, actor, dealer, input, opts.isDemo);

    const [dup] = await tx
      .select({ jobNo: jobs.jobNo })
      .from(jobs)
      .where(and(eq(jobs.vehicleId, vehicle.id), eq(jobs.jobType, input.jobType), eq(jobs.status, "open")))
      .limit(1);
    if (dup) throw new ConflictError(`Vehicle ${vehicle.registrationNo} already has an open ${input.jobType === "service" ? "service" : "body shop"} job (${dup.jobNo})`);

    const jobNo = await nextJobNo(tx, dealer.code, input.jobType);
    const openedAt = opts.openedAt ?? new Date();
    const [job] = await tx
      .insert(jobs)
      .values({
        jobNo,
        jobType: input.jobType,
        dealershipId: dealer.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        appointmentId: input.appointmentId ?? null,
        source: input.source,
        stageCode: first.code,
        commonStage: first.commonStage,
        complaint: input.complaint,
        odometerKm: input.odometerKm ?? null,
        promisedAt: input.promisedAt ?? null,
        estimateAmount: input.estimateAmount ?? null,
        insurerName: input.insurerName || null,
        claimRef: input.claimRef || null,
        openedAt,
        stageEnteredAt: openedAt,
        createdById: actor.id,
        isDemo: opts.isDemo ?? false,
      })
      .returning();
    const list = input.jobType === "service" ? SERVICE_CHECKLIST : BODYSHOP_CHECKLIST;
    await tx.insert(jobChecklistItems).values(list.map((item, i) => ({ jobId: job.id, item, sequence: i })));
    await tx.insert(jobEvents).values({ jobId: job.id, type: "created", toValue: first.code, userId: actor.id, at: openedAt });
    await audit(tx, { userId: actor.id, action: "job.create", entityType: "job", entityId: job.id, dealershipId: dealer.id, after: { jobNo, jobType: job.jobType, stage: first.code } });
    return { job, vehicle };
   });
  }

  await fireAll(db, [
    {
      event: "vehicle_received",
      dealershipId: dealer.id,
      customerId: created.job.customerId,
      jobId: created.job.id,
      context: contextFor(created.job, created.vehicle.registrationNo),
      isDemo: opts.isDemo,
    },
  ]);
  return created.job;
}

/* ───────────────────────── Stage transitions ───────────────────────── */

export async function transitionJob(db: DB, actor: Actor, jobId: string, toCode: string, opts: { reason?: string; expectedVersion?: number; at?: Date } = {}) {
  const job = await loadJobForWrite(db, actor, jobId);
  const stages = await getStages(db, job.dealershipId, job.jobType);
  const check = checkTransition(stages, job, toCode, opts.reason);
  if (!check.ok) throw new ValidationError([check.reason!]);
  const { from, to, direction } = check as Required<typeof check>;
  if (!canMoveJob(actor, job, { fromCommon: from.commonStage, toCommon: to.commonStage, direction })) {
    throw new ForbiddenError("Your role cannot make this stage change");
  }
  const fx = effectsOfEntering(from, to, direction);
  const at = opts.at ?? new Date();
  const patch: Partial<typeof jobs.$inferInsert> = { stageCode: to.code, commonStage: to.commonStage, stageEnteredAt: at };
  if (fx.approvalStatus) patch.approvalStatus = fx.approvalStatus;
  if (fx.setCompletedAt) patch.completedAt = at;
  if (fx.clearCompletedAt) patch.completedAt = null;
  if (fx.setDeliveredAndClose) Object.assign(patch, { deliveredAt: at, closedAt: at, status: "closed" as const });
  if (direction === "forward" && from.commonStage === "approval" && job.blocker === "insurer_approval") patch.blocker = "none";
  if (direction === "forward" && from.commonStage === "estimate_approval" && job.blocker === "customer_approval") patch.blocker = "none";

  const updated = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    const u = await bumpVersion(tx, job.id, opts.expectedVersion, patch);
    await tx.insert(jobEvents).values({ jobId: job.id, type: "stage_change", fromValue: from.code, toValue: to.code, reason: opts.reason ?? (direction === "rework" ? "rework" : null), userId: actor.id, at });
    await audit(tx, { userId: actor.id, action: "job.stage_change", entityType: "job", entityId: job.id, dealershipId: job.dealershipId, before: { stage: from.code }, after: { stage: to.code, direction, reason: opts.reason ?? null } });
    return u;
  });

  if (fx.notify) {
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, job.vehicleId));
    await fireAll(db, [{ event: fx.notify, dealershipId: job.dealershipId, customerId: job.customerId, jobId: job.id, context: contextFor(updated, v.registrationNo), isDemo: job.isDemo }]);
  }
  return updated;
}

/* ───────────────────────── Field updates ───────────────────────── */

const optionalDate = z.union([z.coerce.date(), z.null()]).optional();
export const updateJobInput = z.object({
  complaint: z.string().trim().min(3).optional(),
  odometerKm: z.coerce.number().int().min(0).max(2_000_000).nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  team: z.string().trim().nullable().optional(),
  estimatedHours: z.coerce.number().min(0).max(500).nullable().optional(),
  estimateAmount: z.coerce.number().min(0).nullable().optional(),
  insurerName: z.string().trim().nullable().optional(),
  claimRef: z.string().trim().nullable().optional(),
  blocker: z.enum(BLOCKERS).optional(),
  delayReason: z.string().trim().nullable().optional(),
  nextAction: z.string().trim().nullable().optional(),
  promisedAt: optionalDate,
  expectedCompletionAt: optionalDate,
  invoiceRef: z.string().trim().nullable().optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  isComeback: z.boolean().optional(),
});
export type UpdateJobInput = z.input<typeof updateJobInput>;

const TECH_FIELDS: (keyof UpdateJobInput)[] = ["blocker", "nextAction", "delayReason"];

export async function updateJob(db: DB, actor: Actor, jobId: string, raw: UpdateJobInput, expectedVersion?: number) {
  const job = await loadJobForWrite(db, actor, jobId);
  if (job.status !== "open") throw new ValidationError([`Job is ${job.status}; it can no longer be edited`]);
  const parsed = updateJobInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const patch = parsed.data;

  const isManager = can(actor, "jobs.manage");
  if (!isManager) {
    if (!(can(actor, "jobs.work") && job.assignedToId === actor.id)) throw new ForbiddenError();
    const illegal = Object.keys(patch).filter((k) => !TECH_FIELDS.includes(k as keyof UpdateJobInput));
    if (illegal.length) throw new ForbiddenError(`Your role cannot change: ${illegal.join(", ")}`);
    // Technicians may REPORT a blocker but not clear one (clearing is an advisor/manager decision).
    if (patch.blocker !== undefined && patch.blocker !== job.blocker && (patch.blocker === "none" || job.blocker !== "none")) {
      throw new ForbiddenError("Only the service advisor or manager can clear or change an existing blocker");
    }
  }

  if (patch.assignedToId) {
    const [tech] = await db.select().from(users).where(eq(users.id, patch.assignedToId));
    if (!tech || !tech.active || tech.role !== "technician") throw new ValidationError(["Assignee must be an active technician"]);
    const [scoped] = await db.select().from(userDealerships).where(and(eq(userDealerships.userId, tech.id), eq(userDealerships.dealershipId, job.dealershipId)));
    if (!scoped) throw new ValidationError(["Assignee must be a technician at this dealership"]);
  }
  if (patch.blocker && patch.blocker !== "none" && patch.blocker !== job.blocker && !(patch.delayReason ?? job.delayReason ?? patch.nextAction)) {
    // A blocker should always carry a reason so the delay is explainable.
    throw new ValidationError(["Add a delay reason when marking the job as blocked"]);
  }

  const { before, after } = diff(job as Record<string, unknown>, patch as Record<string, unknown>);
  const changed = Object.keys(after);
  if (!changed.length) return job;

  // Customer-facing delay: expected completion moves past what the customer was last told.
  let delayNotice: Date | null = null;
  if (patch.expectedCompletionAt !== undefined || patch.promisedAt !== undefined) {
    const lastTold = job.expectedCompletionAt && job.promisedAt ? new Date(Math.max(job.expectedCompletionAt.getTime(), job.promisedAt.getTime())) : job.expectedCompletionAt ?? job.promisedAt;
    const newExpected = (patch.expectedCompletionAt ?? patch.promisedAt) ?? null;
    if (isCustomerFacingDelay(lastTold, newExpected)) {
      if (!(patch.delayReason ?? job.delayReason)) throw new ValidationError(["Give a delay reason when pushing the expected delivery later"]);
      delayNotice = newExpected;
    }
  }

  const updated = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    const u = await bumpVersion(tx, job.id, expectedVersion, patch as Partial<typeof jobs.$inferInsert>);
    await tx.insert(jobEvents).values(
      changed.map((field) => ({
        jobId: job.id,
        type: "field_change" as const,
        field,
        fromValue: stringify((before as Record<string, unknown>)[field]),
        toValue: stringify((after as Record<string, unknown>)[field]),
        userId: actor.id,
      })),
    );
    await audit(tx, { userId: actor.id, action: "job.update", entityType: "job", entityId: job.id, dealershipId: job.dealershipId, before, after });
    return u;
  });

  if (delayNotice && job.status === "open") {
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, job.vehicleId));
    await fireAll(db, [{
      event: "repair_delayed", dealershipId: job.dealershipId, customerId: job.customerId, jobId: job.id, variant: delayNotice.toISOString(),
      context: { ...contextFor(updated, v.registrationNo), expectedAt: delayNotice, delayReason: updated.delayReason }, isDemo: job.isDemo,
    }]);
  }
  return updated;
}

function stringify(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/* ───────────────────────── Approvals ───────────────────────── */

export async function recordApproval(db: DB, actor: Actor, jobId: string, decision: "approved" | "declined", approvedAmount: number | null, note?: string) {
  assertCan(actor, "jobs.manage");
  const job = await loadJobForWrite(db, actor, jobId);
  if (job.status !== "open") throw new ValidationError(["Job is not open"]);
  if (job.approvalStatus !== "pending") throw new ValidationError(["No approval is pending for this job"]);
  if (decision === "approved" && (approvedAmount == null || approvedAmount < 0)) throw new ValidationError(["Enter the approved amount"]);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    const u = await bumpVersion(tx, job.id, undefined, {
      approvalStatus: decision,
      approvedAmount: decision === "approved" ? approvedAmount : null,
      blocker: ["customer_approval", "insurer_approval"].includes(job.blocker) ? "none" : job.blocker,
    });
    await tx.insert(jobEvents).values({ jobId: job.id, type: "field_change", field: "approvalStatus", fromValue: "pending", toValue: decision, reason: note ?? null, userId: actor.id });
    await audit(tx, { userId: actor.id, action: "job.approval", entityType: "job", entityId: job.id, dealershipId: job.dealershipId, before: { approvalStatus: "pending" }, after: { approvalStatus: decision, approvedAmount, note } });
    return u;
  });
}

/* ───────────────────────── Cancel / notes ───────────────────────── */

export async function cancelJob(db: DB, actor: Actor, jobId: string, reason: string) {
  assertCan(actor, "jobs.manage");
  const job = await loadJobForWrite(db, actor, jobId);
  if (job.status !== "open") throw new ValidationError([`Job is already ${job.status}`]);
  if (!reason?.trim()) throw new ValidationError(["A cancellation reason is required"]);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    const u = await bumpVersion(tx, job.id, undefined, { status: "cancelled", closedAt: new Date() });
    await tx.insert(jobEvents).values({ jobId: job.id, type: "field_change", field: "status", fromValue: "open", toValue: "cancelled", reason, userId: actor.id });
    await audit(tx, { userId: actor.id, action: "job.cancel", entityType: "job", entityId: job.id, dealershipId: job.dealershipId, before: { status: "open" }, after: { status: "cancelled", reason } });
    return u;
  });
}

export async function addNote(db: DB, actor: Actor, jobId: string, text: string) {
  const job = await loadJobForWrite(db, actor, jobId);
  if (!can(actor, "jobs.manage") && job.assignedToId !== actor.id) throw new ForbiddenError();
  if (!text.trim()) throw new ValidationError(["Note is empty"]);
  await db.insert(jobEvents).values({ jobId: job.id, type: "note", reason: text.trim().slice(0, 2000), userId: actor.id });
}

/* ───────────────────────── Checklist, parts, labour, photos ───────────────────────── */

async function assertCanWork(actor: Actor, job: typeof jobs.$inferSelect) {
  if (job.status !== "open") throw new ValidationError(["Job is not open"]);
  if (can(actor, "jobs.manage")) return;
  if (can(actor, "jobs.work") && job.assignedToId === actor.id) return;
  throw new ForbiddenError();
}

export async function setChecklistItem(db: DB, actor: Actor, itemId: string, result: "pending" | "ok" | "attention" | "na", note?: string | null) {
  const [item] = await db.select().from(jobChecklistItems).where(eq(jobChecklistItems.id, itemId));
  if (!item) throw new NotFoundError();
  const job = await loadJobForWrite(db, actor, item.jobId);
  await assertCanWork(actor, job);
  await db.update(jobChecklistItems).set({ result, note: note ?? item.note }).where(eq(jobChecklistItems.id, itemId));
  if (item.result !== result) {
    await db.insert(jobEvents).values({ jobId: job.id, type: "field_change", field: `checklist:${item.item}`, fromValue: item.result, toValue: result, userId: actor.id });
  }
}

export async function addPart(db: DB, actor: Actor, jobId: string, input: { description: string; partNo?: string | null; quantity: number }) {
  const job = await loadJobForWrite(db, actor, jobId);
  await assertCanWork(actor, job);
  if (!input.description?.trim()) throw new ValidationError(["Part description is required"]);
  if (!(input.quantity > 0)) throw new ValidationError(["Quantity must be greater than zero"]);
  const [p] = await db.insert(jobParts).values({ jobId, description: input.description.trim(), partNo: input.partNo?.trim() || null, quantity: input.quantity }).returning();
  await db.insert(jobEvents).values({ jobId, type: "field_change", field: "parts", toValue: `Requested: ${p.description} × ${p.quantity}`, userId: actor.id });
  return p;
}

/** Marking a part unavailable sets the job's parts blocker; issuing the last missing part clears it. */
export async function setPartStatus(db: DB, actor: Actor, partId: string, status: "requested" | "issued" | "unavailable" | "returned") {
  const [part] = await db.select().from(jobParts).where(eq(jobParts.id, partId));
  if (!part) throw new NotFoundError();
  const job = await loadJobForWrite(db, actor, part.jobId);
  if (!can(actor, "jobs.manage")) throw new ForbiddenError("Only advisors/managers update parts status");
  if (job.status !== "open") throw new ValidationError(["Job is not open"]);
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    await tx.update(jobParts).set({ status, issuedAt: status === "issued" ? new Date() : part.issuedAt }).where(eq(jobParts.id, partId));
    await tx.insert(jobEvents).values({ jobId: job.id, type: "field_change", field: "parts", fromValue: `${part.description}: ${part.status}`, toValue: `${part.description}: ${status}`, userId: actor.id });
    const remaining = await tx.select({ id: jobParts.id }).from(jobParts).where(and(eq(jobParts.jobId, job.id), eq(jobParts.status, "unavailable")));
    let blocker: Blocker | null = null;
    if (status === "unavailable" && job.blocker === "none") blocker = "parts";
    if (!remaining.length && job.blocker === "parts") blocker = "none";
    if (blocker) {
      await bumpVersion(tx, job.id, undefined, { blocker, delayReason: blocker === "parts" ? job.delayReason ?? `Waiting for part: ${part.description}` : job.delayReason });
      await tx.insert(jobEvents).values({ jobId: job.id, type: "field_change", field: "blocker", fromValue: job.blocker, toValue: blocker, userId: actor.id });
    }
  });
}

export async function logLabour(db: DB, actor: Actor, jobId: string, input: { hours: number; workDate?: string }) {
  const job = await loadJobForWrite(db, actor, jobId);
  await assertCanWork(actor, job);
  if (!(input.hours > 0 && input.hours <= 16)) throw new ValidationError(["Hours must be between 0 and 16"]);
  const workDate = input.workDate ?? businessDate();
  if (workDate > businessDate()) throw new ValidationError(["Work date cannot be in the future"]);
  if (workDate < businessDate(job.openedAt)) throw new ValidationError(["Work date cannot be before the job was opened"]);
  if (workDate < addDays(businessDate(), -LABOUR_BACKDATE_DAYS)) throw new ValidationError([`Labour older than ${LABOUR_BACKDATE_DAYS} days can't be added — ask your manager`]);
  const resourceType = job.jobType === "service" ? "service_bay" : job.commonStage === "painting" ? "paint_booth" : "body_bay";
  const [l] = await db
    .insert(labourLogs)
    .values({ jobId, dealershipId: job.dealershipId, resourceType, workDate, hours: input.hours, technicianId: actor.role === "technician" ? actor.id : job.assignedToId, isDemo: job.isDemo })
    .returning();
  await db.insert(jobEvents).values({ jobId, type: "field_change", field: "labour", toValue: `${input.hours} h on ${workDate} (${resourceType.replace("_", " ")})`, userId: actor.id });
  return l;
}

export async function addPhoto(db: DB, actor: Actor, jobId: string, file: { name: string; type: string; bytes: Uint8Array }, caption?: string) {
  const job = await loadJobForWrite(db, actor, jobId);
  await assertCanWork(actor, job);
  const key = await saveUpload(`jobs/${jobId}`, file);
  const [p] = await db.insert(jobPhotos).values({ jobId, storageKey: key, contentType: file.type, caption: caption?.trim() || null, uploadedById: actor.id }).returning();
  await db.insert(jobEvents).values({ jobId, type: "field_change", field: "photo", toValue: caption?.trim() || file.name, userId: actor.id });
  return p;
}

/* ───────────────────────── Queries ───────────────────────── */

export interface JobListFilters {
  jobType?: JobType;
  dealershipId?: string;
  status?: "open" | "closed" | "cancelled" | "all";
  mine?: boolean;
  q?: string;
  overdue?: boolean;
  blocked?: boolean;
}

export async function listJobs(db: DB, actor: Actor, f: JobListFilters = {}) {
  assertCan(actor, "jobs.view");
  const conds: (SQL | undefined)[] = [demoFilter(jobs.isDemo)];
  const scope = dealershipScope(actor);
  if (scope !== "all") conds.push(scope.length ? inArray(jobs.dealershipId, scope) : sql`false`);
  if (actor.role === "technician" || f.mine) conds.push(eq(jobs.assignedToId, actor.id));
  if (f.jobType) conds.push(eq(jobs.jobType, f.jobType));
  if (f.dealershipId) conds.push(eq(jobs.dealershipId, f.dealershipId));
  if (f.status && f.status !== "all") conds.push(eq(jobs.status, f.status));
  if (!f.status) conds.push(eq(jobs.status, "open"));
  if (f.overdue) conds.push(sql`coalesce(${jobs.promisedAt}, ${jobs.expectedCompletionAt}) < now()`);
  if (f.blocked) conds.push(ne(jobs.blocker, "none"));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(jobs.jobNo, q), ilike(vehicles.registrationNo, `%${normaliseReg(f.q)}%`), ilike(customers.name, q)));
  }
  const rows = await db
    .select({
      job: jobs,
      reg: vehicles.registrationNo,
      make: vehicles.make,
      model: vehicles.model,
      customerName: customers.name,
      dealershipName: dealerships.name,
      dealershipCode: dealerships.code,
      assigneeName: users.name,
    })
    .from(jobs)
    .innerJoin(vehicles, eq(vehicles.id, jobs.vehicleId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(dealerships, eq(dealerships.id, jobs.dealershipId))
    .leftJoin(users, eq(users.id, jobs.assignedToId))
    .where(and(...conds))
    .orderBy(asc(sql`coalesce(${jobs.promisedAt}, ${jobs.expectedCompletionAt}, ${jobs.openedAt} + interval '30 days')`), desc(jobs.openedAt))
    .limit(500);
  return rows;
}

/** Headline figures for the jobs list (independent of the list's status/search filters). */
export async function jobSummary(db: DB, actor: Actor, f: { jobType?: "service" | "bodyshop"; dealershipId?: string; mine?: boolean } = {}) {
  assertCan(actor, "jobs.view");
  const conds: (SQL | undefined)[] = [demoFilter(jobs.isDemo)];
  const scope = dealershipScope(actor);
  if (scope !== "all") conds.push(scope.length ? inArray(jobs.dealershipId, scope) : sql`false`);
  if (actor.role === "technician" || f.mine) conds.push(eq(jobs.assignedToId, actor.id));
  if (f.jobType) conds.push(eq(jobs.jobType, f.jobType));
  if (f.dealershipId) conds.push(eq(jobs.dealershipId, f.dealershipId));
  const today = businessDate();
  const dayStart = zonedMidnight(today);
  const dayEnd = zonedMidnight(addDays(today, 1));
  const monthStart = zonedMidnight(`${today.slice(0, 7)}-01`);
  const due = sql`coalesce(${jobs.promisedAt}, ${jobs.expectedCompletionAt})`;
  const open = sql`${jobs.status} = 'open'`;
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${open})`,
      overdue: sql<number>`count(*) filter (where ${open} and ${due} < now())`,
      dueToday: sql<number>`count(*) filter (where ${open} and ${due} >= now() and ${due} < ${dayEnd})`,
      awaitingApproval: sql<number>`count(*) filter (where ${open} and ${jobs.approvalStatus} = 'pending')`,
      waitingParts: sql<number>`count(*) filter (where ${open} and ${jobs.blocker} = 'parts')`,
      blocked: sql<number>`count(*) filter (where ${open} and ${jobs.blocker} <> 'none')`,
      openedToday: sql<number>`count(*) filter (where ${jobs.openedAt} >= ${dayStart} and ${jobs.openedAt} < ${dayEnd})`,
      deliveredToday: sql<number>`count(*) filter (where ${jobs.deliveredAt} >= ${dayStart} and ${jobs.deliveredAt} < ${dayEnd})`,
      deliveredMtd: sql<number>`count(*) filter (where ${jobs.deliveredAt} >= ${monthStart})`,
      onTimeMtd: sql<number>`count(*) filter (where ${jobs.deliveredAt} >= ${monthStart} and ${jobs.promisedAt} is not null and ${jobs.deliveredAt} <= ${jobs.promisedAt})`,
      withPromiseMtd: sql<number>`count(*) filter (where ${jobs.deliveredAt} >= ${monthStart} and ${jobs.promisedAt} is not null)`,
      avgTatHoursMtd: sql<number | null>`avg(extract(epoch from (${jobs.deliveredAt} - ${jobs.openedAt})) / 3600) filter (where ${jobs.deliveredAt} >= ${monthStart})`,
    })
    .from(jobs)
    .where(and(...conds));
  const n = (x: unknown) => Number(x ?? 0);
  return {
    open: n(r.open), overdue: n(r.overdue), dueToday: n(r.dueToday), awaitingApproval: n(r.awaitingApproval), waitingParts: n(r.waitingParts), blocked: n(r.blocked),
    openedToday: n(r.openedToday), deliveredToday: n(r.deliveredToday), deliveredMtd: n(r.deliveredMtd),
    onTimePctMtd: n(r.withPromiseMtd) ? Math.round((n(r.onTimeMtd) / n(r.withPromiseMtd)) * 1000) / 10 : null,
    avgTatHoursMtd: r.avgTatHoursMtd == null ? null : Math.round(Number(r.avgTatHoursMtd) * 10) / 10,
  };
}

export async function getJobDetail(db: DB, actor: Actor, jobId: string) {
  const [row] = await db
    .select({ job: jobs, vehicle: vehicles, customer: customers, dealership: dealerships })
    .from(jobs)
    .innerJoin(vehicles, eq(vehicles.id, jobs.vehicleId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(dealerships, eq(dealerships.id, jobs.dealershipId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!row || (DATA_MODE === "live" && row.job.isDemo)) throw new NotFoundError("Job not found");
  if (!canViewJob(actor, row.job)) throw new ForbiddenError("This job is outside your access scope");

  const showContact = can(actor, "customers.contact");
  const [stages, checklist, parts, photos, labour, events, notes, technicians] = await Promise.all([
    getStages(db, row.job.dealershipId, row.job.jobType),
    db.select().from(jobChecklistItems).where(eq(jobChecklistItems.jobId, jobId)).orderBy(asc(jobChecklistItems.sequence)),
    db.select().from(jobParts).where(eq(jobParts.jobId, jobId)).orderBy(asc(jobParts.requestedAt)),
    db.select().from(jobPhotos).where(eq(jobPhotos.jobId, jobId)).orderBy(asc(jobPhotos.createdAt)),
    db.select().from(labourLogs).where(eq(labourLogs.jobId, jobId)).orderBy(asc(labourLogs.workDate)),
    db.select({ e: jobEvents, userName: users.name }).from(jobEvents).leftJoin(users, eq(users.id, jobEvents.userId)).where(eq(jobEvents.jobId, jobId)).orderBy(desc(jobEvents.at)),
    db.select().from(notifications).where(eq(notifications.jobId, jobId)).orderBy(desc(notifications.createdAt)),
    technicianOptions(db, row.job.dealershipId),
  ]);
  const assignee = row.job.assignedToId ? technicians.find((t) => t.id === row.job.assignedToId) ?? null : null;
  return {
    job: row.job,
    vehicle: row.vehicle,
    dealership: row.dealership,
    customer: {
      id: row.customer.id,
      name: row.customer.name,
      phone: showContact ? row.customer.phone : null,
      email: showContact ? row.customer.email : null,
      preferredChannel: row.customer.preferredChannel,
      consent: { whatsapp: row.customer.consentWhatsapp, sms: row.customer.consentSms, email: row.customer.consentEmail },
      contactHidden: !showContact,
    },
    stages: sortStages(stages),
    checklist,
    parts,
    photos,
    labour,
    labourHours: labour.reduce((a, l) => a + l.hours, 0),
    events,
    notifications: notes,
    technicians,
    assignee,
    workStage: WORK_STAGES.includes(row.job.commonStage as CommonStage),
  };
}

export async function technicianOptions(db: DB, dealershipId: string) {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(sql`user_dealerships ud`, sql`ud.user_id = ${users.id}`)
    .where(and(eq(users.role, "technician"), eq(users.active, true), sql`ud.dealership_id = ${dealershipId}`))
    .orderBy(asc(users.name));
}
