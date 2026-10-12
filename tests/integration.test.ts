/**
 * Integration tests — real services against an in-memory Postgres (PGlite) with migrations applied.
 * Covers: job workflow + audit, permissions/entity boundaries, notifications (consent, dedupe, retry),
 * duplicate prevention, CSV import, double-counting at dashboard level, and period filtering.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { useInMemoryDbForTests, type DB } from "@/db/client";
import * as s from "@/db/schema";
import { ensureDefaultStages } from "@/db/seed-demo";
import { hashPassword } from "@/server/password";
import { login, actorFromToken } from "@/server/session";
import { loadActor, type Actor } from "@/server/principal";
import { createJob, transitionJob, updateJob, recordApproval, setPartStatus, addPart, logLabour, listJobs, getJobDetail, cancelJob } from "@/server/services/jobs";
import { createAppointment, checkInAppointment } from "@/server/services/appointments";
import { createManualTransaction, importTransactionsCsv, upsertTarget } from "@/server/services/finance";
import { saveDailyReport, updateAlert } from "@/server/services/reporting";
import { saveStageConfig, retryNotification, saveUser } from "@/server/services/admin";
import { buildDashboard } from "@/server/analytics";
import { setProviderForTests, type NotificationProvider } from "@/server/notify/providers";
import { resolvePeriod, businessDate, addDays } from "@/domain/periods";
import { ForbiddenError } from "@/domain/permissions";
import { ValidationError, ConflictError } from "@/server/errors";
import { defaultStages } from "@/domain/workflow";

let db: DB;
let regSeq = 1000;
const ids: Record<string, string> = {};
const actors: Record<string, Actor> = {};
const sent: { channel: string; body: string }[] = [];
let failNext = false;
const testProvider: NotificationProvider = {
  name: "test",
  channels: ["whatsapp", "sms", "email"],
  async send(m) {
    if (failNext) {
      failNext = false;
      return { ok: false, error: "simulated outage" };
    }
    sent.push({ channel: m.channel, body: m.body });
    return { ok: true, providerRef: `t-${sent.length}` };
  },
};

beforeAll(async () => {
  db = await useInMemoryDbForTests();
  await ensureDefaultStages(db);
  setProviderForTests(testProvider);
  const [le1, le2] = await db.insert(s.legalEntities).values([{ code: "LE1", name: "Test Entity 1" }, { code: "LE2", name: "Test Entity 2" }]).returning();
  const [b1, b2] = await db.insert(s.brands).values([{ name: "BrandA" }, { name: "BrandB" }]).returning();
  const [d1, d2] = await db
    .insert(s.dealerships)
    .values([
      { code: "DA", name: "Dealer A", brandId: b1.id, legalEntityId: le1.id, locationName: "Loc A", hasBodyShop: true },
      { code: "DB", name: "Dealer B", brandId: b2.id, legalEntityId: le2.id, locationName: "Loc B", hasBodyShop: false },
    ])
    .returning();
  ids.d1 = d1.id;
  ids.d2 = d2.id;
  const pw = await hashPassword("correct-horse-battery");
  const mk = async (key: string, role: s.Role, dealers: string[]) => {
    const [u] = await db.insert(s.users).values({ email: `${key}@t.local`, name: key, role, passwordHash: pw }).returning();
    if (dealers.length) await db.insert(s.userDealerships).values(dealers.map((d) => ({ userId: u.id, dealershipId: d })));
    ids[key] = u.id;
    actors[key] = (await loadActor(db, u.id))!;
  };
  await mk("md", "md", []);
  await mk("fin", "group_finance", []);
  await mk("mgrA", "dealership_manager", [d1.id]);
  await mk("advA", "service_advisor", [d1.id]);
  await mk("advB", "service_advisor", [d2.id]);
  await mk("techA", "technician", [d1.id]);
  await mk("techA2", "technician", [d1.id]);
  await mk("admin", "admin", []);
  await db.insert(s.capacityProfiles).values({ dealershipId: d1.id, resourceType: "service_bay", physicalUnits: 2, productiveHoursPerUnitPerDay: 5, workingDays: "1111111" });
});

beforeEach(() => {
  sent.length = 0;
});

const newJob = (over: Partial<Parameters<typeof createJob>[2]> = {}) =>
  createJob(db, actors.advA, {
    dealershipId: ids.d1,
    jobType: "service",
    customerName: "Test Customer",
    phone: "9876543210",
    registrationNo: `tn 01 ab ${String(++regSeq).padStart(4, "0")}`,
    consentWhatsapp: true,
    preferredChannel: "whatsapp",
    complaint: "Periodic service",
    promisedAt: new Date(Date.now() + 8 * 3600_000),
    ...over,
  });

describe("auth", () => {
  it("logs in with a correct password only, and resolves the session", async () => {
    expect(await login(db, "md@t.local", "wrong-password-123")).toBeNull();
    const ok = await login(db, "MD@t.local", "correct-horse-battery");
    expect(ok?.actor.role).toBe("md");
    const a = await actorFromToken(db, ok!.token);
    expect(a?.id).toBe(ids.md);
    expect(await actorFromToken(db, "forged")).toBeNull();
  });
});

describe("service job workflow", () => {
  it("creates a job card with checklist, audit trail and a 'vehicle received' notification", async () => {
    const job = await newJob();
    expect(job.jobNo).toMatch(/^SVC-DA-\d{4}-0001$/);
    expect(job.stageCode).toBe("registered");
    const detail = await getJobDetail(db, actors.advA, job.id);
    expect(detail.checklist.length).toBeGreaterThan(5);
    expect(detail.events.map((e) => e.e.type)).toContain("created");
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe("whatsapp");
    expect(sent[0].body).toContain(job.jobNo);
    const audit = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, job.id), eq(s.auditLog.action, "job.create")));
    expect(audit[0].userId).toBe(ids.advA);
  });

  it("moves through every stage to delivery with guards, notifications and timestamps", async () => {
    let job = await newJob();
    job = await transitionJob(db, actors.advA, job.id, "inspection");
    job = await updateJob(db, actors.advA, job.id, { estimateAmount: 12500 });
    job = await transitionJob(db, actors.advA, job.id, "estimate_approval");
    expect(job.approvalStatus).toBe("pending");
    expect(sent.map((x) => x.body).some((b) => b.includes("₹12,500"))).toBe(true); // approval_required
    await expect(transitionJob(db, actors.advA, job.id, "in_progress")).rejects.toThrow(/approval/);
    job = await recordApproval(db, actors.advA, job.id, "approved", 12500);
    await expect(transitionJob(db, actors.advA, job.id, "in_progress")).rejects.toThrow(/Assign a technician/);
    job = await updateJob(db, actors.advA, job.id, { assignedToId: ids.techA });
    job = await transitionJob(db, actors.advA, job.id, "in_progress");

    // Technician: can log labour and move own job to QC, but not to billing
    await logLabour(db, actors.techA, job.id, { hours: 2.5 });
    job = await transitionJob(db, actors.techA, job.id, "quality_check");
    await expect(transitionJob(db, actors.techA, job.id, "billing")).rejects.toBeInstanceOf(ForbiddenError);

    job = await transitionJob(db, actors.advA, job.id, "billing");
    job = await transitionJob(db, actors.advA, job.id, "ready");
    expect(job.completedAt).not.toBeNull();
    await expect(transitionJob(db, actors.advA, job.id, "delivered")).rejects.toThrow(/invoice/);
    job = await updateJob(db, actors.advA, job.id, { invoiceRef: "INV-77", paymentStatus: "paid" });
    job = await transitionJob(db, actors.advA, job.id, "delivered");
    expect(job.status).toBe("closed");
    expect(job.deliveredAt).not.toBeNull();

    const events = await db.select().from(s.jobEvents).where(and(eq(s.jobEvents.jobId, job.id), eq(s.jobEvents.type, "stage_change")));
    expect(events.map((e) => e.toValue)).toEqual(["inspection", "estimate_approval", "in_progress", "quality_check", "billing", "ready", "delivered"]);
    expect(events.every((e) => e.userId && e.at)).toBe(true);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.jobId, job.id));
    expect(notes.map((n) => n.event).sort()).toEqual(["approval_required", "vehicle_ready", "vehicle_received"]);
    // closed jobs are immutable
    await expect(updateJob(db, actors.advA, job.id, { nextAction: "x" })).rejects.toThrow(/closed/);
  });

  it("rework requires a reason and is recorded", async () => {
    let job = await newJob();
    for (const st of ["inspection", "estimate_approval"]) job = await transitionJob(db, actors.advA, job.id, st);
    await recordApproval(db, actors.advA, job.id, "approved", 100);
    await updateJob(db, actors.advA, job.id, { assignedToId: ids.techA });
    await transitionJob(db, actors.advA, job.id, "in_progress");
    await transitionJob(db, actors.advA, job.id, "quality_check");
    await expect(transitionJob(db, actors.advA, job.id, "in_progress")).rejects.toThrow(/reason/);
    job = await transitionJob(db, actors.advA, job.id, "in_progress", { reason: "QC failed: brake squeal" });
    const [ev] = await db.select().from(s.jobEvents).where(and(eq(s.jobEvents.jobId, job.id), eq(s.jobEvents.toValue, "in_progress"), eq(s.jobEvents.reason, "QC failed: brake squeal")));
    expect(ev).toBeTruthy();
  });

  it("optimistic locking rejects stale edits", async () => {
    const job = await newJob();
    await updateJob(db, actors.advA, job.id, { nextAction: "Call customer" }, job.version);
    await expect(updateJob(db, actors.advA, job.id, { nextAction: "Stale edit" }, job.version)).rejects.toBeInstanceOf(ConflictError);
  });

  it("prevents duplicate open jobs for the same vehicle and re-uses customers/vehicles", async () => {
    const reg = "KA05MN4321";
    const j1 = await newJob({ registrationNo: reg });
    await expect(newJob({ registrationNo: "ka 05 mn 4321" })).rejects.toThrow(/already has an open service job/);
    await cancelJob(db, actors.advA, j1.id, "Customer withdrew");
    const j2 = await newJob({ registrationNo: "KA-05-MN-4321" });
    expect(j2.vehicleId).toBe(j1.vehicleId);
    expect(j2.customerId).toBe(j1.customerId);
  });

  it("job numbers continue from the highest existing number, even with gaps", async () => {
    const j = await newJob();
    const prefix = j.jobNo.slice(0, -4);
    await db.update(s.jobs).set({ jobNo: `${prefix}0040` }).where(eq(s.jobs.id, j.id)); // simulate a gap
    const k = await newJob();
    expect(k.jobNo).toBe(`${prefix}0041`);
  });

  it("validates required fields", async () => {
    await expect(newJob({ complaint: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(newJob({ registrationNo: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createJob(db, actors.advB, { dealershipId: ids.d2, jobType: "bodyshop", customerName: "X Y", registrationNo: "AB12CD3456", complaint: "Dent" })).rejects.toThrow(/not configured with a body shop/);
  });

  it("marking a part unavailable blocks billing; issuing it clears the blocker", async () => {
    let job = await newJob();
    const part = await addPart(db, actors.advA, job.id, { description: "Brake pads", quantity: 1 });
    await setPartStatus(db, actors.advA, part.id, "unavailable");
    [job] = await db.select().from(s.jobs).where(eq(s.jobs.id, job.id));
    expect(job.blocker).toBe("parts");
    expect(job.delayReason).toMatch(/Brake pads/);
    await setPartStatus(db, actors.advA, part.id, "issued");
    [job] = await db.select().from(s.jobs).where(eq(s.jobs.id, job.id));
    expect(job.blocker).toBe("none");
  });

  it("a later expected delivery needs a reason and notifies the customer once per new date", async () => {
    const job = await newJob();
    const later = new Date(job.promisedAt!.getTime() + 24 * 3600_000);
    await expect(updateJob(db, actors.advA, job.id, { expectedCompletionAt: later })).rejects.toThrow(/delay reason/);
    await updateJob(db, actors.advA, job.id, { expectedCompletionAt: later, delayReason: "Part on back-order" });
    await updateJob(db, actors.advA, job.id, { nextAction: "Chase supplier" }); // internal change → no notification
    const delays = await db.select().from(s.notifications).where(and(eq(s.notifications.jobId, job.id), eq(s.notifications.event, "repair_delayed")));
    expect(delays).toHaveLength(1);
    expect(delays[0].body).toContain("Part on back-order");
  });
});

describe("notifications", () => {
  it("records SKIPPED when there is no consent, and supports retry after failure", async () => {
    const noConsent = await newJob({ consentWhatsapp: false, preferredChannel: null, phone: "9000000001", registrationNo: "NC01AA0001" });
    const [n] = await db.select().from(s.notifications).where(eq(s.notifications.jobId, noConsent.id));
    expect(n.status).toBe("skipped");
    expect(n.skipReason).toMatch(/consent/);

    failNext = true;
    const j = await newJob({ phone: "9000000002", registrationNo: "RT01AA0002" });
    const [f] = await db.select().from(s.notifications).where(eq(s.notifications.jobId, j.id));
    expect(f.status).toBe("failed");
    expect(f.lastError).toBe("simulated outage");
    const r = await retryNotification(db, actors.advA, f.id);
    expect(r.status).toBe("sent");
    expect(r.attempts).toBe(2);
    await expect(retryNotification(db, actors.advA, f.id)).rejects.toThrow(/Only failed/);
  });

  it("appointment confirmation + check-in creates a linked job (capture once)", async () => {
    const at = new Date(Date.now() + 2 * 3600_000);
    const appt = await createAppointment(db, actors.advA, { dealershipId: ids.d1, customerName: "Appt Customer", phone: "9111111111", registrationNo: "AP01XY1111", consentSms: true, scheduledAt: at, requestedWork: "AC check" });
    expect(sent.some((m) => m.channel === "sms" && m.body.includes("confirmed"))).toBe(true);
    await expect(createAppointment(db, actors.advA, { dealershipId: ids.d1, customerName: "Appt Customer", phone: "9111111111", registrationNo: "AP01XY1111", scheduledAt: at, requestedWork: "AC check" })).rejects.toThrow(/already has an appointment/);
    const job = await checkInAppointment(db, actors.advA, appt.id);
    expect(job.source).toBe("appointment");
    expect(job.complaint).toBe("AC check");
    const [a] = await db.select().from(s.appointments).where(eq(s.appointments.id, appt.id));
    expect(a.status).toBe("attended");
    expect(a.jobId).toBe(job.id);
  });
});

describe("permissions & entity boundaries", () => {
  it("advisor of dealer B cannot see or touch dealer A jobs", async () => {
    const job = await newJob();
    await expect(getJobDetail(db, actors.advB, job.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(transitionJob(db, actors.advB, job.id, "inspection")).rejects.toBeInstanceOf(ForbiddenError);
    const listB = await listJobs(db, actors.advB, {});
    expect(listB.every((r) => r.job.dealershipId === ids.d2)).toBe(true);
  });

  it("technicians only see their assigned jobs and cannot read customer contact details", async () => {
    const job = await newJob();
    await updateJob(db, actors.advA, job.id, { assignedToId: ids.techA2 });
    await expect(getJobDetail(db, actors.techA, job.id)).rejects.toBeInstanceOf(ForbiddenError);
    const d = await getJobDetail(db, actors.techA2, job.id);
    expect(d.customer.phone).toBeNull();
    expect(d.customer.contactHidden).toBe(true);
    const mine = await listJobs(db, actors.techA2, {});
    expect(mine.every((r) => r.job.assignedToId === ids.techA2)).toBe(true);
    await expect(updateJob(db, actors.techA2, job.id, { estimateAmount: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("technicians can report a blocker but not clear one; assignees must work at the dealership", async () => {
    const job = await newJob();
    await updateJob(db, actors.advA, job.id, { assignedToId: ids.techA });
    await updateJob(db, actors.techA, job.id, { blocker: "parts", delayReason: "Pads out of stock" });
    await expect(updateJob(db, actors.techA, job.id, { blocker: "none" })).rejects.toBeInstanceOf(ForbiddenError);
    await updateJob(db, actors.advA, job.id, { blocker: "none" });
    const [otherTech] = await db.insert(s.users).values({ email: "techB@t.local", name: "techB", role: "technician", passwordHash: "x" }).returning();
    await db.insert(s.userDealerships).values({ userId: otherTech.id, dealershipId: ids.d2 });
    await expect(updateJob(db, actors.advA, job.id, { assignedToId: otherTech.id })).rejects.toThrow(/at this dealership/);
  });

  it("labour cannot be logged before the job opened or long after the fact", async () => {
    const job = await newJob();
    await updateJob(db, actors.advA, job.id, { assignedToId: ids.techA });
    await expect(logLabour(db, actors.techA, job.id, { hours: 1, workDate: addDays(businessDate(), -3) })).rejects.toThrow(/before the job was opened/);
    await logLabour(db, actors.techA, job.id, { hours: 1 });
  });

  it("dashboards: MD sees all dealerships; a manager only theirs; an advisor none", async () => {
    const p = resolvePeriod("mtd", businessDate());
    const g = await buildDashboard(db, actors.md, p, { requires: "group.dashboard" });
    expect(g.dealers.map((d) => d.dealer.code).sort()).toEqual(["DA", "DB"]);
    const m = await buildDashboard(db, actors.mgrA, p);
    expect(m.dealers.map((d) => d.dealer.code)).toEqual(["DA"]);
    await expect(buildDashboard(db, actors.mgrA, p, { requires: "group.dashboard" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(buildDashboard(db, actors.advA, p)).rejects.toBeInstanceOf(ForbiddenError);
    // Manager asking for another dealership gets nothing (scope intersection)
    const other = await buildDashboard(db, actors.mgrA, p, { dealershipIds: [ids.d2] });
    expect(other.dealers).toHaveLength(0);
  });

  it("admin role changes are audited and revoke sessions", async () => {
    const sess = await login(db, "advB@t.local", "correct-horse-battery");
    await saveUser(db, actors.admin, { id: ids.advB, email: "advB@t.local", name: "advB", role: "dealership_manager", dealershipIds: [ids.d2], active: true });
    expect(await actorFromToken(db, sess!.token)).toBeNull();
    const [a] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, ids.advB), eq(s.auditLog.action, "user.update")));
    expect((a.before as { role: string }).role).toBe("service_advisor");
    expect((a.after as { role: string }).role).toBe("dealership_manager");
    await expect(saveUser(db, actors.mgrA, { email: "x@t.local", name: "X", role: "md", password: "long-password-1" })).rejects.toBeInstanceOf(ForbiddenError);
    // restore
    await saveUser(db, actors.admin, { id: ids.advB, email: "advB@t.local", name: "advB", role: "service_advisor", dealershipIds: [ids.d2], active: true });
    actors.advB = (await loadActor(db, ids.advB))!;
  });
});

describe("configurable workflow", () => {
  it("a location can split a stage; reporting still maps to the common stage", async () => {
    const bs = defaultStages("bodyshop");
    const custom = [...bs.filter((x) => x.code !== "painting"), { code: "primer", label: "Primer", commonStage: "painting", sequence: 48 }, { code: "booth", label: "Booth", commonStage: "painting", sequence: 52 }];
    await saveStageConfig(db, actors.admin, ids.d1, "bodyshop", custom);
    await expect(saveStageConfig(db, actors.admin, ids.d1, "bodyshop", bs.filter((x) => x.code !== "quality_check"))).rejects.toThrow(/Missing/);
    let job = await createJob(db, actors.advA, { dealershipId: ids.d1, jobType: "bodyshop", customerName: "Body Cust", registrationNo: "BS01AA9999", complaint: "Bumper dent" });
    expect(job.jobNo).toMatch(/^BSH-DA-/);
    for (const st of ["assessment", "approval"]) job = await transitionJob(db, actors.advA, job.id, st);
    await recordApproval(db, actors.advA, job.id, "approved", 30000);
    await updateJob(db, actors.advA, job.id, { assignedToId: ids.techA });
    job = await transitionJob(db, actors.advA, job.id, "denting");
    job = await transitionJob(db, actors.advA, job.id, "primer");
    expect(job.commonStage).toBe("painting");
    await expect(transitionJob(db, actors.advA, job.id, "finishing")).rejects.toThrow(/Paint|Booth|skipped/);
    job = await transitionJob(db, actors.techA, job.id, "booth");
    expect(job.commonStage).toBe("painting");
  });
});

describe("finance: entry, import, double counting, periods", () => {
  const today = businessDate();
  const yesterday = addDays(today, -1);

  it("manual entry validates and blocks duplicate invoice lines", async () => {
    await createManualTransaction(db, actors.mgrA, { dealershipId: ids.d1, businessDate: yesterday, category: "service_labour", kind: "invoice", revenueAmount: 10_000, directCostAmount: 4_000, invoiceRef: "INV-A1" });
    await expect(createManualTransaction(db, actors.mgrA, { dealershipId: ids.d1, businessDate: yesterday, category: "service_labour", kind: "invoice", revenueAmount: 10_000, invoiceRef: "inv-a1" })).rejects.toBeInstanceOf(ConflictError);
    // the parts line of the same bundled invoice is a different line and is allowed
    await createManualTransaction(db, actors.mgrA, { dealershipId: ids.d1, businessDate: yesterday, category: "parts", partsChannel: "workshop", kind: "invoice", revenueAmount: 6_000, directCostAmount: 4_500, invoiceRef: "INV-A1" });
    await expect(createManualTransaction(db, actors.mgrA, { dealershipId: ids.d2, businessDate: yesterday, category: "parts", partsChannel: "retail", kind: "invoice", revenueAmount: 1, invoiceRef: "Z" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createManualTransaction(db, actors.advA, { dealershipId: ids.d1, businessDate: yesterday, category: "parts", partsChannel: "retail", kind: "invoice", revenueAmount: 1, invoiceRef: "Z" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("CSV import: validates rows, reports duplicates on re-import, is idempotent", async () => {
    const csv = [
      "business_date,dealership_code,category,kind,parts_channel,revenue_amount,tax_amount,direct_cost_amount,units,invoice_ref,source_ref",
      `${yesterday},DA,vehicle_sales,invoice,,1000000,280000,940000,1,VS-1,EXP-VS-1`,
      `${yesterday},DA,vehicle_sales,booking_advance,,50000,,,,ADV-1,EXP-ADV-1`,
      `${yesterday},DB,parts,invoice,retail,"20,000",,15000,,PR-1,EXP-PR-1`,
      `${yesterday},DB,parts,intercompany,retail,30000,,29000,,IC-1,EXP-IC-1`,
      `${yesterday},DA,parts,invoice,,5000,,,,PX,EXP-BAD-1`,
      `${yesterday},ZZ,parts,invoice,retail,5000,,,,PX,EXP-BAD-2`,
      `${today.slice(0, 4)}-99-01,DA,parts,invoice,retail,5000,,,,PX,EXP-BAD-3`,
    ].join("\n");
    const dry = await importTransactionsCsv(db, actors.fin, "export.csv", csv, { dryRun: true });
    expect(dry.batchId).toBeNull();
    expect([dry.rowsAccepted, dry.rowsRejected]).toEqual([4, 3]);
    const r1 = await importTransactionsCsv(db, actors.fin, "export.csv", csv);
    expect([r1.rowsAccepted, r1.rowsRejected, r1.rowsDuplicate]).toEqual([4, 3, 0]);
    expect(r1.results.find((x) => x.row === 6)!.message).toMatch(/channel/);
    const r2 = await importTransactionsCsv(db, actors.fin, "export.csv", csv);
    expect([r2.rowsAccepted, r2.rowsDuplicate]).toEqual([0, 4]);
    await expect(importTransactionsCsv(db, actors.mgrA, "x.csv", csv)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("dashboard totals come from stored records, exclude advances/intercompany, and respond to the period", async () => {
    const yp = resolvePeriod("custom", today, { start: yesterday, end: yesterday });
    const d = await buildDashboard(db, actors.md, yp, { requires: "group.dashboard", syncAlerts: false });
    const A = d.dealers.find((x) => x.dealer.code === "DA")!;
    const B = d.dealers.find((x) => x.dealer.code === "DB")!;
    // A: 10,000 labour + 6,000 workshop parts + 1,000,000 vehicle (advance excluded)
    expect(A.revenue.total).toBe(1_016_000);
    expect(A.revenue.byCategory).toEqual({ vehicle_sales: 1_000_000, service_labour: 10_000, parts: 6_000, body_shop: 0 });
    expect(A.revenue.excluded.bookingAdvances).toBe(50_000);
    expect(A.revenue.vehiclesDelivered).toBe(1);
    expect(A.revenue.gp).toMatchObject({ status: "complete", amount: 67_500 });
    // B: 20,000 retail parts; intercompany excluded
    expect(B.revenue.total).toBe(20_000);
    expect(B.revenue.excluded.intercompany).toBe(30_000);
    expect(d.total.revenue.total).toBe(1_036_000);
    // A different period does not include yesterday's lines
    const older = resolvePeriod("custom", today, { start: addDays(today, -10), end: addDays(today, -5) });
    const d2 = await buildDashboard(db, actors.md, older, { requires: "group.dashboard", syncAlerts: false });
    expect(d2.total.revenue.total).toBe(0);
    expect(d2.total.revenue.gp.status).toBe("no_revenue");
  });

  it("target achievement uses approved targets only; utilisation uses labour logs ÷ capacity", async () => {
    const month = yesterday.slice(0, 7);
    await upsertTarget(db, actors.fin, { dealershipId: ids.d1, month, revenueTarget: 31_000_000, deliveriesTarget: 31, approve: false });
    const yp = resolvePeriod("custom", today, { start: yesterday, end: yesterday });
    let d = await buildDashboard(db, actors.md, yp, { requires: "group.dashboard", syncAlerts: false });
    expect(d.dealers.find((x) => x.dealer.code === "DA")!.revenueTargetAchievementPct).toBeNull();
    await upsertTarget(db, actors.fin, { dealershipId: ids.d1, month, revenueTarget: 31_000_000, deliveriesTarget: 31, approve: true });
    d = await buildDashboard(db, actors.md, yp, { requires: "group.dashboard", syncAlerts: false });
    const A = d.dealers.find((x) => x.dealer.code === "DA")!;
    const [y, m] = month.split("-").map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    expect(A.revenueTarget).toBeCloseTo(31_000_000 / dim, 1);
    expect(A.revenueTargetAchievementPct).toBeCloseTo(Math.round((1_016_000 / (31_000_000 / dim)) * 1000) / 10, 1);
    expect(d.total.revenueTargetCoverage).toEqual({ withTarget: 1, total: 2 });

    // Utilisation: 2 bays × 5 h = 10 h available yesterday; log 6 h → 60%
    const job = await newJob({ registrationNo: "UT01AA0001" });
    await db.update(s.jobs).set({ openedAt: new Date(Date.now() - 36 * 3600_000) }).where(eq(s.jobs.id, job.id)); // opened yesterday
    await updateJob(db, actors.advA, job.id, { assignedToId: ids.techA });
    await logLabour(db, actors.advA, job.id, { hours: 6, workDate: yesterday });
    d = await buildDashboard(db, actors.md, yp, { requires: "group.dashboard", syncAlerts: false });
    const cap = d.dealers.find((x) => x.dealer.code === "DA")!.capacity.service;
    expect([cap.available, cap.used, cap.utilisationPct]).toEqual([10, 6, 60]);
    // The current (incomplete) day is excluded from utilisation
    const t = await buildDashboard(db, actors.md, resolvePeriod("today", today), { requires: "group.dashboard", syncAlerts: false });
    expect(t.dealers.find((x) => x.dealer.code === "DA")!.capacity.service.utilisationPct).toBeNull();
  });

  it("daily report feeds the pipeline; alerts can be owned and resolved with a note", async () => {
    await saveDailyReport(db, actors.mgrA, { dealershipId: ids.d1, businessDate: yesterday, leads: 12, bookings: 3, bookingCancellations: 1, expectedDeliveries7d: 5, submit: true });
    await expect(saveDailyReport(db, actors.mgrA, { dealershipId: ids.d2, businessDate: yesterday, leads: 1, bookings: 1, submit: true })).rejects.toBeInstanceOf(ForbiddenError);
    const yp = resolvePeriod("custom", today, { start: yesterday, end: yesterday });
    const d = await buildDashboard(db, actors.md, yp, { requires: "group.dashboard" });
    expect(d.total.pipeline).toMatchObject({ leads: 12, bookings: 3, cancellations: 1, expectedDeliveries7d: 5 });
    const missing = d.alerts.find((a) => a.ruleCode === "daily_report_missing" && a.dealershipName === "Dealer B");
    expect(missing).toBeTruthy();
    await expect(updateAlert(db, actors.md, missing!.id, { status: "resolved" })).rejects.toThrow(/note/);
    const upd = await updateAlert(db, actors.md, missing!.id, { status: "in_progress", ownerId: ids.md, dueDate: today });
    expect(upd.ownerId).toBe(ids.md);
    // Re-evaluating keeps the owner/status
    const d2 = await buildDashboard(db, actors.md, yp, { requires: "group.dashboard" });
    expect(d2.alerts.find((a) => a.id === missing!.id)!.status).toBe("in_progress");
  });
});
