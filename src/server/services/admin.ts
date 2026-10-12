import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import {
  users, userDealerships, dealerships, brands, legalEntities, workflowStages, capacityProfiles, auditLog, notifications, customers, jobs,
  ROLES, RESOURCE_TYPES, type JobType,
} from "@/db/schema";
import { assertCan, can, dealershipScope, GROUP_WIDE_ROLES } from "@/domain/permissions";
import { validateStageConfig, defaultStages, type CommonStage } from "@/domain/workflow";
import type { Actor } from "../principal";
import { audit } from "../audit";
import { hashPassword } from "../password";
import { revokeUserSessions } from "../session";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { demoFilter } from "../data-mode";
import { attempt } from "../notify/dispatcher";

/* ───────────────────────── Users ───────────────────────── */

export const userInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2),
  role: z.enum(ROLES),
  dealershipIds: z.array(z.string().uuid()).default([]),
  active: z.boolean().default(true),
  password: z.string().min(10, "Password must be at least 10 characters").optional().or(z.literal("")),
});

export async function listUsers(db: DB, actor: Actor) {
  assertCan(actor, "admin.users");
  const us = await db.select().from(users).where(demoFilter(users.isDemo)).orderBy(asc(users.name));
  const scopes = await db.select().from(userDealerships);
  return us.map(({ passwordHash: _ph, ...u }) => ({ ...u, dealershipIds: scopes.filter((s) => s.userId === u.id).map((s) => s.dealershipId) }));
}

export async function saveUser(db: DB, actor: Actor, raw: z.input<typeof userInput> & { id?: string }) {
  assertCan(actor, "admin.users");
  const parsed = userInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const input = parsed.data;
  if (!GROUP_WIDE_ROLES.includes(input.role) && !input.dealershipIds.length) throw new ValidationError(["Location-bound roles need at least one dealership"]);
  if (input.role === "kiosk" && input.dealershipIds.length !== 1) throw new ValidationError(["A kiosk device must be linked to exactly one dealership"]);
  if (raw.id === actor.id && (input.role !== actor.role || !input.active)) throw new ValidationError(["You cannot change your own role or deactivate yourself"]);
  const scopeIds = GROUP_WIDE_ROLES.includes(input.role) ? [] : input.dealershipIds;

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    if (raw.id) {
      const [before] = await tx.select().from(users).where(eq(users.id, raw.id));
      if (!before) throw new NotFoundError("User not found");
      const beforeScopes = (await tx.select().from(userDealerships).where(eq(userDealerships.userId, raw.id))).map((s) => s.dealershipId);
      const patch: Partial<typeof users.$inferInsert> = { email: input.email, name: input.name, role: input.role, active: input.active };
      if (input.password) patch.passwordHash = await hashPassword(input.password);
      await tx.update(users).set(patch).where(eq(users.id, raw.id));
      await tx.delete(userDealerships).where(eq(userDealerships.userId, raw.id));
      if (scopeIds.length) await tx.insert(userDealerships).values(scopeIds.map((d) => ({ userId: raw.id!, dealershipId: d })));
      if (before.role !== input.role || !input.active || input.password || beforeScopes.sort().join() !== [...scopeIds].sort().join()) await revokeUserSessions(tx, raw.id);
      await audit(tx, {
        userId: actor.id, action: "user.update", entityType: "user", entityId: raw.id,
        before: { email: before.email, role: before.role, active: before.active, dealershipIds: beforeScopes },
        after: { email: input.email, role: input.role, active: input.active, dealershipIds: scopeIds, passwordChanged: !!input.password },
      });
      return raw.id;
    }
    if (!input.password) throw new ValidationError(["Set an initial password"]);
    const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (exists) throw new ConflictError("A user with this email already exists");
    const [u] = await tx.insert(users).values({ email: input.email, name: input.name, role: input.role, active: input.active, passwordHash: await hashPassword(input.password) }).returning();
    if (scopeIds.length) await tx.insert(userDealerships).values(scopeIds.map((d) => ({ userId: u.id, dealershipId: d })));
    await audit(tx, { userId: actor.id, action: "user.create", entityType: "user", entityId: u.id, after: { email: u.email, role: u.role, dealershipIds: scopeIds } });
    return u.id;
  });
}

/* ───────────────────────── Master data ───────────────────────── */

export async function listMasterData(db: DB) {
  const [les, bs, ds] = await Promise.all([
    db.select().from(legalEntities).where(demoFilter(legalEntities.isDemo)).orderBy(asc(legalEntities.name)),
    db.select().from(brands).where(demoFilter(brands.isDemo)).orderBy(asc(brands.name)),
    db.select().from(dealerships).where(demoFilter(dealerships.isDemo)).orderBy(asc(dealerships.name)),
  ]);
  return { legalEntities: les, brands: bs, dealerships: ds };
}

export async function saveLegalEntity(db: DB, actor: Actor, input: { id?: string; code: string; name: string; registrationRef?: string | null }) {
  assertCan(actor, "admin.master_data");
  if (!input.code.trim() || !input.name.trim()) throw new ValidationError(["Code and name are required"]);
  const values = { code: input.code.trim().toUpperCase(), name: input.name.trim(), registrationRef: input.registrationRef?.trim() || null };
  const [row] = input.id
    ? await db.update(legalEntities).set(values).where(eq(legalEntities.id, input.id)).returning()
    : await db.insert(legalEntities).values(values).returning();
  await audit(db, { userId: actor.id, action: input.id ? "legal_entity.update" : "legal_entity.create", entityType: "legal_entity", entityId: row.id, after: values });
  return row;
}

export async function saveBrand(db: DB, actor: Actor, input: { name: string }) {
  assertCan(actor, "admin.master_data");
  if (!input.name.trim()) throw new ValidationError(["Brand name is required"]);
  const [row] = await db.insert(brands).values({ name: input.name.trim() }).onConflictDoNothing().returning();
  if (!row) throw new ConflictError("Brand already exists");
  await audit(db, { userId: actor.id, action: "brand.create", entityType: "brand", entityId: row.id, after: { name: row.name } });
  return row;
}

export const dealershipInput = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "Code: 2–8 letters/digits"),
  name: z.string().trim().min(2),
  brandId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  locationName: z.string().trim().min(2),
  city: z.string().trim().nullable().optional(),
  hasSales: z.boolean(),
  hasService: z.boolean(),
  hasBodyShop: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value").nullable().optional(),
  active: z.boolean().default(true),
});

export async function saveDealership(db: DB, actor: Actor, raw: z.input<typeof dealershipInput>) {
  assertCan(actor, "admin.master_data");
  const parsed = dealershipInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const { id, ...values } = parsed.data;
  const [dup] = await db.select({ id: dealerships.id }).from(dealerships).where(eq(dealerships.code, values.code));
  if (dup && dup.id !== id) throw new ConflictError("Dealership code already in use");
  if (id) {
    const [before] = await db.select().from(dealerships).where(eq(dealerships.id, id));
    if (!before) throw new NotFoundError();
    if (before.legalEntityId !== values.legalEntityId) {
      const [{ n }] = await db.select({ n: sql<number>`(select count(*) from jobs where dealership_id = ${id}) + (select count(*) from transactions where dealership_id = ${id}) + (select count(*) from customers where dealership_id = ${id})` }).from(sql`(select 1) as one`);
      if (Number(n) > 0) throw new ValidationError(["Legal entity cannot be changed once records exist (transactions retain their original entity)"]);
    }
    const [row] = await db.update(dealerships).set(values).where(eq(dealerships.id, id)).returning();
    await audit(db, { userId: actor.id, action: "dealership.update", entityType: "dealership", entityId: id, dealershipId: id, before, after: row });
    return row;
  }
  const [row] = await db.insert(dealerships).values(values).returning();
  await audit(db, { userId: actor.id, action: "dealership.create", entityType: "dealership", entityId: row.id, dealershipId: row.id, after: row });
  return row;
}

/* ───────────────────────── Capacity ───────────────────────── */

export async function saveCapacity(db: DB, actor: Actor, input: { dealershipId: string; resourceType: (typeof RESOURCE_TYPES)[number]; physicalUnits: number; productiveHoursPerUnitPerDay: number; workingDays: string }) {
  assertCan(actor, "admin.master_data");
  if (!RESOURCE_TYPES.includes(input.resourceType)) throw new ValidationError(["Unknown resource type"]);
  if (!(Number.isInteger(input.physicalUnits) && input.physicalUnits >= 0 && input.physicalUnits <= 500)) throw new ValidationError(["Units must be a whole number"]);
  if (!(input.productiveHoursPerUnitPerDay >= 0 && input.productiveHoursPerUnitPerDay <= 24)) throw new ValidationError(["Productive hours per day must be 0–24"]);
  if (!/^[01]{7}$/.test(input.workingDays)) throw new ValidationError(["Working days must be 7 flags Mon..Sun"]);
  const [before] = await db.select().from(capacityProfiles).where(and(eq(capacityProfiles.dealershipId, input.dealershipId), eq(capacityProfiles.resourceType, input.resourceType)));
  const [row] = await db
    .insert(capacityProfiles)
    .values(input)
    .onConflictDoUpdate({ target: [capacityProfiles.dealershipId, capacityProfiles.resourceType], set: { physicalUnits: input.physicalUnits, productiveHoursPerUnitPerDay: input.productiveHoursPerUnitPerDay, workingDays: input.workingDays } })
    .returning();
  await audit(db, { userId: actor.id, action: "capacity.update", entityType: "capacity_profile", entityId: row.id, dealershipId: input.dealershipId, before: before ?? null, after: row });
  return row;
}

export async function listCapacity(db: DB) {
  return db.select().from(capacityProfiles).where(demoFilter(capacityProfiles.isDemo));
}

/* ───────────────────────── Workflow configuration ───────────────────────── */

export async function listStageConfig(db: DB, dealershipId: string | null, jobType: JobType) {
  const rows = await db
    .select()
    .from(workflowStages)
    .where(and(eq(workflowStages.jobType, jobType), dealershipId ? eq(workflowStages.dealershipId, dealershipId) : sql`${workflowStages.dealershipId} is null`))
    .orderBy(asc(workflowStages.sequence));
  return rows;
}

/** Replace a location's stage configuration (validated against the common reporting model). */
export async function saveStageConfig(db: DB, actor: Actor, dealershipId: string | null, jobType: JobType, stages: { code: string; label: string; commonStage: string; sequence: number }[]) {
  assertCan(actor, "admin.workflow");
  const defs = stages.map((s) => ({ ...s, code: s.code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"), label: s.label.trim(), commonStage: s.commonStage as CommonStage }));
  const errs = validateStageConfig(jobType, defs);
  if (errs.length) throw new ValidationError(errs);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    const before = await listStageConfig(tx, dealershipId, jobType);
    // Open jobs must still find their current stage.
    // Open jobs must still find their current stage: for a location, its own jobs; for the group
    // default, jobs at every location that has no override of its own.
    const overridden = dealershipId ? [] : (await tx.selectDistinct({ d: workflowStages.dealershipId }).from(workflowStages).where(and(eq(workflowStages.jobType, jobType), sql`${workflowStages.dealershipId} is not null`))).map((r) => r.d!);
    const openStages = await tx
      .selectDistinct({ code: jobs.stageCode })
      .from(jobs)
      .where(and(
        eq(jobs.status, "open"),
        eq(jobs.jobType, jobType),
        dealershipId ? eq(jobs.dealershipId, dealershipId) : overridden.length ? sql`${jobs.dealershipId} not in (${sql.join(overridden.map((o) => sql`${o}`), sql`, `)})` : sql`true`,
      ));
    const missing = openStages.filter((o) => !defs.some((d) => d.code === o.code));
    if (missing.length) throw new ValidationError([`Open jobs are in stage(s) ${missing.map((m) => m.code).join(", ")}. Keep those stage codes until the jobs move on.`]);
    await tx.delete(workflowStages).where(and(eq(workflowStages.jobType, jobType), dealershipId ? eq(workflowStages.dealershipId, dealershipId) : sql`${workflowStages.dealershipId} is null`));
    await tx.insert(workflowStages).values(defs.map((d) => ({ ...d, dealershipId, jobType })));
    await audit(tx, { userId: actor.id, action: "workflow.update", entityType: "workflow_stages", entityId: `${dealershipId ?? "group"}:${jobType}`, dealershipId, before, after: defs });
  });
}

export async function resetStageConfig(db: DB, actor: Actor, dealershipId: string, jobType: JobType) {
  assertCan(actor, "admin.workflow");
  const open = await db.select({ code: jobs.stageCode }).from(jobs).where(and(eq(jobs.status, "open"), eq(jobs.jobType, jobType), eq(jobs.dealershipId, dealershipId)));
  const defaults = defaultStages(jobType).map((s) => s.code);
  const orphan = open.filter((o) => !defaults.includes(o.code));
  if (orphan.length) throw new ValidationError(["Open jobs use location-specific stages; move them before resetting"]);
  await db.delete(workflowStages).where(and(eq(workflowStages.jobType, jobType), eq(workflowStages.dealershipId, dealershipId)));
  await audit(db, { userId: actor.id, action: "workflow.reset", entityType: "workflow_stages", entityId: `${dealershipId}:${jobType}`, dealershipId });
}

/* ───────────────────────── Audit & notifications ───────────────────────── */

export async function listAudit(db: DB, actor: Actor, f: { entityType?: string; entityId?: string; limit?: number }) {
  assertCan(actor, "audit.view");
  const scope = dealershipScope(actor);
  return db
    .select({ a: auditLog, userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(
      f.entityType ? eq(auditLog.entityType, f.entityType) : undefined,
      f.entityId ? eq(auditLog.entityId, f.entityId) : undefined,
      scope === "all" ? undefined : scope.length ? inArray(auditLog.dealershipId, scope) : sql`false`,
    ))
    .orderBy(desc(auditLog.at))
    .limit(Math.min(f.limit ?? 200, 1000));
}

export async function listNotifications(db: DB, actor: Actor, f: { status?: string } = {}) {
  assertCan(actor, "notifications.view");
  const scope = dealershipScope(actor);
  return db
    .select({ n: notifications, customerName: customers.name, dealershipName: dealerships.name, jobNo: jobs.jobNo })
    .from(notifications)
    .innerJoin(customers, eq(customers.id, notifications.customerId))
    .innerJoin(dealerships, eq(dealerships.id, notifications.dealershipId))
    .leftJoin(jobs, eq(jobs.id, notifications.jobId))
    .where(and(
      scope === "all" ? undefined : scope.length ? inArray(notifications.dealershipId, scope) : sql`false`,
      f.status ? eq(notifications.status, f.status as "sent") : undefined,
      demoFilter(notifications.isDemo),
    ))
    .orderBy(desc(notifications.createdAt))
    .limit(300);
}

export async function retryNotification(db: DB, actor: Actor, id: string) {
  assertCan(actor, "notifications.retry");
  const [n] = await db.select().from(notifications).where(eq(notifications.id, id));
  if (!n) throw new NotFoundError();
  if (!can(actor, "notifications.retry") || (dealershipScope(actor) !== "all" && !actor.dealershipIds.includes(n.dealershipId))) throw new ValidationError(["Outside your scope"]);
  if (n.status !== "failed") throw new ValidationError([`Only failed notifications can be retried (this one is ${n.status})`]);
  const res = await attempt(db, id);
  await audit(db, { userId: actor.id, action: "notification.retry", entityType: "notification", entityId: id, dealershipId: n.dealershipId, after: { status: res.status, attempts: res.attempts } });
  return res;
}
