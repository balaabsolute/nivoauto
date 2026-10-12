/**
 * DEMO DATASET — for design review and testing only.
 *
 *  ⚠  Every figure generated here is SYNTHETIC and ILLUSTRATIVE. None of it is Kun Automobile data.
 *     Brand / dealership names come from the build brief; legal entities and locations are
 *     placeholders because none were supplied. Every row is flagged is_demo = true and is excluded
 *     when DATA_MODE=live. Volumes, prices, margins and capacities are random draws from a fixed seed.
 *
 *  The generator deliberately creates realistic *states* so every screen can be reviewed:
 *  overdue jobs, parts blockers, pending approvals, a stale dealership, missing daily reports,
 *  provisional gross profit (missing costs), unreconciled lines, booking advances, an intercompany
 *  line, a credit note, failed notifications awaiting retry and a location-specific body shop workflow.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { DB } from "./client";
import * as s from "./schema";
import { defaultStages, SERVICE_COMMON_STAGES, BODYSHOP_COMMON_STAGES, type StageDef } from "@/domain/workflow";
import { addDays, businessDate, eachDay, eachMonth, fyStart, zonedMidnight, daysInMonth } from "@/domain/periods";
import { hashPassword } from "@/server/password";
import { renderTemplate } from "@/domain/notifications";
import { SERVICE_CHECKLIST, BODYSHOP_CHECKLIST } from "@/server/services/jobs";
import { seedCrmDemo } from "./seed-crm";

export { DEMO_PASSWORD } from "./demo-constants";
import { DEMO_PASSWORD } from "./demo-constants";

/* ───────────── deterministic randomness ───────────── */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(20261012);
const between = (a: number, b: number) => a + rnd() * (b - a);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
function poisson(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > L && k < 200);
  return k - 1;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const HOUR = 3_600_000;

/* ───────────── illustrative dealership profiles (NOT Kun figures) ───────────── */
interface Profile {
  code: string;
  brand: string;
  entity: "A" | "B" | "C";
  bodyShop: boolean;
  models: string[];
  unitsPerDay: number;
  unitPrice: number;
  serviceJobsPerDay: number;
  labourPerJob: number;
  partsPerJob: number;
  retailPartsPerDay: number;
  bodyJobsPerDay: number;
  bodyPerJob: number;
  targetUtil: number;
  targetStretch: number; // target ÷ expected revenue
}
const PROFILES: Profile[] = [
  { code: "HON", brand: "Honda", entity: "A", bodyShop: true, models: ["City", "Amaze", "Elevate"], unitsPerDay: 2.6, unitPrice: 1_150_000, serviceJobsPerDay: 13, labourPerJob: 3_400, partsPerJob: 4_200, retailPartsPerDay: 18_000, bodyJobsPerDay: 1.8, bodyPerJob: 32_000, targetUtil: 0.82, targetStretch: 1.04 },
  { code: "HYU", brand: "Hyundai", entity: "A", bodyShop: true, models: ["Creta", "Venue", "i20", "Verna"], unitsPerDay: 3.1, unitPrice: 1_050_000, serviceJobsPerDay: 15, labourPerJob: 3_100, partsPerJob: 3_900, retailPartsPerDay: 21_000, bodyJobsPerDay: 2.2, bodyPerJob: 29_000, targetUtil: 0.99, targetStretch: 1.02 },
  { code: "BMW", brand: "BMW", entity: "B", bodyShop: true, models: ["3 Series", "X1", "X5", "5 Series"], unitsPerDay: 0.7, unitPrice: 6_800_000, serviceJobsPerDay: 6, labourPerJob: 16_000, partsPerJob: 24_000, retailPartsPerDay: 35_000, bodyJobsPerDay: 0.9, bodyPerJob: 180_000, targetUtil: 0.72, targetStretch: 1.05 },
  { code: "RR", brand: "Rolls-Royce", entity: "B", bodyShop: false, models: ["Ghost", "Cullinan"], unitsPerDay: 0.04, unitPrice: 72_000_000, serviceJobsPerDay: 0.5, labourPerJob: 90_000, partsPerJob: 140_000, retailPartsPerDay: 8_000, bodyJobsPerDay: 0, bodyPerJob: 0, targetUtil: 0.6, targetStretch: 1.0 },
  { code: "VW", brand: "Volkswagen", entity: "C", bodyShop: true, models: ["Virtus", "Taigun", "Tiguan"], unitsPerDay: 1.0, unitPrice: 1_500_000, serviceJobsPerDay: 6, labourPerJob: 4_600, partsPerJob: 5_400, retailPartsPerDay: 9_000, bodyJobsPerDay: 0.8, bodyPerJob: 38_000, targetUtil: 0.58, targetStretch: 1.35 },
  { code: "BYD", brand: "BYD", entity: "C", bodyShop: false, models: ["Atto 3", "Seal", "eMAX 7"], unitsPerDay: 0.6, unitPrice: 3_000_000, serviceJobsPerDay: 2.5, labourPerJob: 4_000, partsPerJob: 3_000, retailPartsPerDay: 4_000, bodyJobsPerDay: 0, bodyPerJob: 0, targetUtil: 0.45, targetStretch: 1.08 },
];

const FIRST = ["Arjun", "Priya", "Karthik", "Divya", "Rahul", "Meena", "Suresh", "Lakshmi", "Vikram", "Anitha", "Ravi", "Deepa", "Ganesh", "Kavya", "Manoj", "Nisha", "Prakash", "Revathi", "Sanjay", "Uma", "Aditya", "Sneha", "Harish", "Pooja"];
const LAST = ["R.", "S.", "K.", "M.", "V.", "N.", "P.", "T.", "A.", "B."];
const COMPLAINTS = ["Periodic maintenance service", "Brake noise when stopping", "AC not cooling", "Engine warning light on", "Wheel alignment & balancing", "Battery drains overnight", "Steering vibration at speed", "Oil leak under engine", "Suspension knocking sound", "Infotainment screen not responding"];
const BODY_COMPLAINTS = ["Front bumper damage — minor collision", "Rear door dent", "Scratch on left side panels", "Bonnet dent and paint damage", "Rear-end collision repair", "Full panel repaint — hail damage"];
const PARTS = ["Oil filter", "Brake pads (front)", "Air filter", "Cabin filter", "Wiper blades", "Spark plugs", "Brake disc", "Battery", "Bumper clip set", "Headlamp assembly", "Door panel", "Paint materials kit"];
const INSURERS = ["Demo Insurer 1", "Demo Insurer 2", "Demo Insurer 3"];

/* ───────────── guards & reset ───────────── */

export function assertDemoAllowed() {
  if (process.env.DATA_MODE === "live") throw new Error("Refusing to seed demo data: DATA_MODE=live");
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") throw new Error("Refusing to seed demo data in production (set ALLOW_DEMO_SEED=1 for a dedicated demo environment)");
}

/** Deletes demo rows only (is_demo = true) and everything hanging off them. Real data is untouched. */
export async function removeDemoData(db: DB) {
  const demoDealers = (await db.select({ id: s.dealerships.id }).from(s.dealerships).where(eq(s.dealerships.isDemo, true))).map((d) => d.id);
  const demoUsers = (await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.isDemo, true))).map((u) => u.id);
  const inDealers = (col: Parameters<typeof inArray>[0]) => (demoDealers.length ? inArray(col, demoDealers) : sql`false`);
  // Everything flagged demo, plus anything (however created) that belongs to a demo dealership.
  const demoOr = (flag: Parameters<typeof eq>[0], dealerCol: Parameters<typeof inArray>[0]) => or(eq(flag, true), inDealers(dealerCol));
  await db.delete(s.alerts).where(inDealers(s.alerts.dealershipId));
  await db.delete(s.notifications).where(demoOr(s.notifications.isDemo, s.notifications.dealershipId));
  // Showroom CRM (lead children cascade with the lead)
  await db.delete(s.loungeFeedback).where(demoOr(s.loungeFeedback.isDemo, s.loungeFeedback.dealershipId));
  await db.delete(s.walkIns).where(demoOr(s.walkIns.isDemo, s.walkIns.dealershipId));
  const demoLeads = db.select({ id: s.leads.id }).from(s.leads).where(demoOr(s.leads.isDemo, s.leads.dealershipId));
  await db.delete(s.followUps).where(inArray(s.followUps.leadId, demoLeads));
  await db.delete(s.leads).where(demoOr(s.leads.isDemo, s.leads.dealershipId));
  const demoModels = db.select({ id: s.carModels.id }).from(s.carModels).where(eq(s.carModels.isDemo, true));
  await db.delete(s.modelUpdates).where(or(eq(s.modelUpdates.isDemo, true), inDealers(s.modelUpdates.dealershipId), inArray(s.modelUpdates.modelId, demoModels)));
  await db.delete(s.transactions).where(demoOr(s.transactions.isDemo, s.transactions.dealershipId));
  await db.delete(s.labourLogs).where(demoOr(s.labourLogs.isDemo, s.labourLogs.dealershipId));
  await db.update(s.appointments).set({ jobId: null }).where(demoOr(s.appointments.isDemo, s.appointments.dealershipId));
  await db.delete(s.jobs).where(demoOr(s.jobs.isDemo, s.jobs.dealershipId));
  await db.delete(s.appointments).where(demoOr(s.appointments.isDemo, s.appointments.dealershipId));
  const demoCustomers = db.select({ id: s.customers.id }).from(s.customers).where(demoOr(s.customers.isDemo, s.customers.dealershipId));
  await db.delete(s.vehicles).where(or(eq(s.vehicles.isDemo, true), inArray(s.vehicles.customerId, demoCustomers)));
  await db.delete(s.customers).where(demoOr(s.customers.isDemo, s.customers.dealershipId));
  await db.delete(s.dailyReports).where(demoOr(s.dailyReports.isDemo, s.dailyReports.dealershipId));
  await db.delete(s.targets).where(demoOr(s.targets.isDemo, s.targets.dealershipId));
  await db.delete(s.capacityProfiles).where(demoOr(s.capacityProfiles.isDemo, s.capacityProfiles.dealershipId));
  await db.delete(s.workflowStages).where(inDealers(s.workflowStages.dealershipId));
  if (demoUsers.length) {
    // Demo users may have touched non-demo records; keep those records, drop the user link.
    await db.update(s.jobEvents).set({ userId: null }).where(inArray(s.jobEvents.userId, demoUsers));
    await db.update(s.jobs).set({ createdById: null }).where(inArray(s.jobs.createdById, demoUsers));
    await db.update(s.jobs).set({ assignedToId: null }).where(inArray(s.jobs.assignedToId, demoUsers));
    await db.update(s.transactions).set({ createdById: null }).where(inArray(s.transactions.createdById, demoUsers));
    await db.update(s.appointments).set({ createdById: null }).where(inArray(s.appointments.createdById, demoUsers));
    await db.update(s.alerts).set({ ownerId: null }).where(inArray(s.alerts.ownerId, demoUsers));
    await db.update(s.targets).set({ approvedById: null }).where(inArray(s.targets.approvedById, demoUsers));
    await db.update(s.dailyReports).set({ submittedById: null }).where(inArray(s.dailyReports.submittedById, demoUsers));
    await db.update(s.jobPhotos).set({ uploadedById: null }).where(inArray(s.jobPhotos.uploadedById, demoUsers));
    await db.update(s.labourLogs).set({ technicianId: null }).where(inArray(s.labourLogs.technicianId, demoUsers));
    await db.update(s.leads).set({ consultantId: null }).where(inArray(s.leads.consultantId, demoUsers));
    await db.update(s.leads).set({ createdById: null }).where(inArray(s.leads.createdById, demoUsers));
    await db.update(s.walkIns).set({ attendedById: null }).where(inArray(s.walkIns.attendedById, demoUsers));
    await db.update(s.walkIns).set({ kioskUserId: null }).where(inArray(s.walkIns.kioskUserId, demoUsers));
    await db.update(s.loungeFeedback).set({ kioskUserId: null }).where(inArray(s.loungeFeedback.kioskUserId, demoUsers));
    await db.update(s.testDrives).set({ consultantId: null }).where(inArray(s.testDrives.consultantId, demoUsers));
    await db.update(s.leadActivities).set({ userId: null }).where(inArray(s.leadActivities.userId, demoUsers));
    await db.update(s.followUps).set({ assignedToId: null }).where(inArray(s.followUps.assignedToId, demoUsers));
    await db.update(s.followUps).set({ completedById: null }).where(inArray(s.followUps.completedById, demoUsers));
    await db.update(s.modelUpdates).set({ createdById: null }).where(inArray(s.modelUpdates.createdById, demoUsers));
    await db.delete(s.importBatches).where(inArray(s.importBatches.createdById, demoUsers));
    await db.delete(s.auditLog).where(or(inArray(s.auditLog.userId, demoUsers), inDealers(s.auditLog.dealershipId)));
  }
  await db.delete(s.users).where(eq(s.users.isDemo, true));
  await db.delete(s.carModels).where(eq(s.carModels.isDemo, true));
  await db.delete(s.dealerships).where(eq(s.dealerships.isDemo, true));
  await db.delete(s.brands).where(eq(s.brands.isDemo, true));
  await db.delete(s.legalEntities).where(eq(s.legalEntities.isDemo, true));
}

/** Group-default workflow stages (configuration, not demo data). Idempotent. */
export async function ensureDefaultStages(db: DB) {
  for (const jt of ["service", "bodyshop"] as const) {
    const existing = await db.select({ id: s.workflowStages.id }).from(s.workflowStages).where(and(eq(s.workflowStages.jobType, jt), sql`${s.workflowStages.dealershipId} is null`));
    if (!existing.length) await db.insert(s.workflowStages).values(defaultStages(jt).map((d) => ({ ...d, jobType: jt, dealershipId: null })));
  }
}

async function insertChunked<T>(db: DB, table: Parameters<DB["insert"]>[0], rows: T[], size = 1000) {
  for (let i = 0; i < rows.length; i += size) await db.insert(table).values(rows.slice(i, i + size) as never);
}

/* ───────────── main ───────────── */

export async function seedDemo(db: DB, opts: { now?: Date; log?: (m: string) => void; jobHistoryDays?: number; financeFrom?: string } = {}) {
  assertDemoAllowed();
  rnd = mulberry32(20261012);
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const today = businessDate(now);
  const jobHistoryDays = opts.jobHistoryDays ?? 120;
  const financeFrom = opts.financeFrom ?? fyStart(addDays(fyStart(today), -1)); // start of previous FY → supports YTD comparison

  await removeDemoData(db);
  await ensureDefaultStages(db);

  /* Master data */
  log("master data");
  const entities = await db
    .insert(s.legalEntities)
    .values(["A", "B", "C"].map((x) => ({ code: `DEMO-LE-${x}`, name: `Demo Entity ${x}`, isDemo: true })))
    .returning();
  const entityBy = (x: string) => entities.find((e) => e.code === `DEMO-LE-${x}`)!;
  const brandRows = await db.insert(s.brands).values(PROFILES.map((p) => ({ name: p.brand, isDemo: true }))).onConflictDoNothing().returning();
  const allBrands = brandRows.length === PROFILES.length ? brandRows : await db.select().from(s.brands);
  const dealers = await db
    .insert(s.dealerships)
    .values(PROFILES.map((p) => ({
      code: p.code, name: `Kun ${p.brand} (demo)`, brandId: allBrands.find((b) => b.name === p.brand)!.id, legalEntityId: entityBy(p.entity).id,
      locationName: "Location TBC", city: null, hasSales: true, hasService: true, hasBodyShop: p.bodyShop, isDemo: true,
    })))
    .returning();
  const dealerBy = (code: string) => dealers.find((d) => d.code === code)!;

  // Location-specific workflow variant (demo of configurability): BMW splits painting into two stages.
  const bmwBody: StageDef[] = [
    ...defaultStages("bodyshop").filter((st) => st.code !== "painting"),
    { code: "primer", label: "Primer & preparation", commonStage: "painting", sequence: 48 },
    { code: "paint_booth", label: "Paint booth", commonStage: "painting", sequence: 52 },
  ];
  await db.insert(s.workflowStages).values(bmwBody.map((d) => ({ ...d, jobType: "bodyshop" as const, dealershipId: dealerBy("BMW").id })));

  /* Users */
  log("users");
  const pw = await hashPassword(DEMO_PASSWORD);
  const mkUser = (email: string, name: string, role: s.Role) => ({ email, name, role, passwordHash: pw, isDemo: true });
  const userRows = [
    mkUser("md@demo.kun.local", "Demo Managing Director", "md"),
    mkUser("finance@demo.kun.local", "Demo Group Finance Manager", "group_finance"),
    mkUser("admin@demo.kun.local", "Demo Administrator", "admin"),
  ];
  for (const p of PROFILES) {
    const c = p.code.toLowerCase();
    userRows.push(mkUser(`manager.${c}@demo.kun.local`, `Demo Manager — ${p.brand}`, "dealership_manager"));
    userRows.push(mkUser(`advisor.${c}@demo.kun.local`, `Demo Advisor — ${p.brand}`, "service_advisor"));
    const techs = p.serviceJobsPerDay > 5 ? 3 : 2;
    for (let i = 1; i <= techs; i++) userRows.push(mkUser(`tech${i}.${c}@demo.kun.local`, `Demo Technician ${i} — ${p.brand}`, "technician"));
    const sales = p.code === "RR" ? 1 : 2;
    for (let i = 1; i <= sales; i++) userRows.push(mkUser(`sales${i}.${c}@demo.kun.local`, `Demo Sales Consultant ${i} — ${p.brand}`, "sales_consultant"));
    userRows.push(mkUser(`kiosk.${c}@demo.kun.local`, `Demo Kiosk — ${p.brand} showroom`, "kiosk"));
  }
  const users = await db.insert(s.users).values(userRows).returning();
  const scopeRows: { userId: string; dealershipId: string }[] = [];
  for (const u of users) {
    const m = u.email.match(/\.(\w+)@demo/);
    if (m && u.role !== "md" && u.role !== "group_finance" && u.role !== "admin") scopeRows.push({ userId: u.id, dealershipId: dealerBy(m[1].toUpperCase()).id });
  }
  await db.insert(s.userDealerships).values(scopeRows);
  const finance = users.find((u) => u.role === "group_finance")!;
  const techsOf = (dealerId: string) => users.filter((u) => u.role === "technician" && scopeRows.some((r) => r.userId === u.id && r.dealershipId === dealerId));
  const managerOf = (dealerId: string) => users.find((u) => u.role === "dealership_manager" && scopeRows.some((r) => r.userId === u.id && r.dealershipId === dealerId))!;
  const advisorOf = (dealerId: string) => users.find((u) => u.role === "service_advisor" && scopeRows.some((r) => r.userId === u.id && r.dealershipId === dealerId))!;

  /* Customers & vehicles */
  log("customers");
  const custRows: (typeof s.customers.$inferInsert)[] = [];
  const pool: Record<string, { customerIdx: number; model: string }[]> = {};
  for (const p of PROFILES) {
    const d = dealerBy(p.code);
    const n = Math.max(40, Math.round(p.serviceJobsPerDay * 25));
    pool[d.id] = [];
    for (let i = 0; i < n; i++) {
      const wa = chance(0.75);
      const sms = chance(0.5);
      const em = chance(0.4);
      custRows.push({
        legalEntityId: d.legalEntityId, dealershipId: d.id, name: `${pick(FIRST)} ${pick(LAST)} (demo)`,
        phone: `+9190000${String(custRows.length).padStart(5, "0")}`, email: em ? `customer${custRows.length}@example.invalid` : null,
        preferredChannel: wa ? "whatsapp" : sms ? "sms" : em ? "email" : null, consentWhatsapp: wa, consentSms: sms, consentEmail: em,
        consentRecordedAt: wa || sms || em ? new Date(now.getTime() - 200 * 24 * HOUR) : null, isDemo: true,
      });
      pool[d.id].push({ customerIdx: custRows.length - 1, model: pick(p.models) });
    }
  }
  const customers: (typeof s.customers.$inferSelect)[] = [];
  for (let i = 0; i < custRows.length; i += 1000) customers.push(...(await db.insert(s.customers).values(custRows.slice(i, i + 1000)).returning()));
  const vehRows = customers.map((c, i) => {
    const prof = PROFILES.find((p) => dealerBy(p.code).id === c.dealershipId)!;
    const entry = pool[c.dealershipId].find((e) => e.customerIdx === i);
    return { customerId: c.id, registrationNo: `DM${String(10 + (i % 80)).padStart(2, "0")}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 7) % 26))}${String(1000 + i).slice(-4)}`, make: prof.brand, model: entry?.model ?? prof.models[0], year: 2018 + (i % 8), isDemo: true };
  });
  const vehicles: (typeof s.vehicles.$inferSelect)[] = [];
  for (let i = 0; i < vehRows.length; i += 1000) vehicles.push(...(await db.insert(s.vehicles).values(vehRows.slice(i, i + 1000)).returning()));
  const vehiclesOf = (dealerId: string) => vehicles.filter((v) => customers.find((c) => c.id === v.customerId)!.dealershipId === dealerId);

  /* Capacity profiles sized from the illustrative demand and a per-dealer utilisation level */
  log("capacity");
  const capRows: (typeof s.capacityProfiles.$inferInsert)[] = [];
  for (const p of PROFILES) {
    const d = dealerBy(p.code);
    const dailySvcHours = p.serviceJobsPerDay * 2.6;
    const hpu = 7;
    capRows.push({ dealershipId: d.id, resourceType: "service_bay", physicalUnits: Math.max(1, Math.round(dailySvcHours / (hpu * p.targetUtil))), productiveHoursPerUnitPerDay: hpu, workingDays: "1111110", isDemo: true });
    if (p.bodyShop) {
      capRows.push({ dealershipId: d.id, resourceType: "body_bay", physicalUnits: Math.max(1, Math.round((p.bodyJobsPerDay * 9) / (7 * 0.8))), productiveHoursPerUnitPerDay: 7, workingDays: "1111110", isDemo: true });
      capRows.push({ dealershipId: d.id, resourceType: "paint_booth", physicalUnits: Math.max(1, Math.round((p.bodyJobsPerDay * 4) / (8 * 0.85))), productiveHoursPerUnitPerDay: 8, workingDays: "1111110", isDemo: true });
    }
  }
  await db.insert(s.capacityProfiles).values(capRows);

  /* Jobs (service + body shop) */
  log("jobs");
  const stagesSvc = defaultStages("service");
  const stagesBody = (dealerId: string) => (dealerId === dealerBy("BMW").id ? bmwBody.sort((a, b) => a.sequence - b.sequence) : defaultStages("bodyshop"));
  type JobIns = typeof s.jobs.$inferInsert & { id: string };
  const jobRows: JobIns[] = [];
  const eventRows: (typeof s.jobEvents.$inferInsert)[] = [];
  const checklistRows: (typeof s.jobChecklistItems.$inferInsert)[] = [];
  const partRows: (typeof s.jobParts.$inferInsert)[] = [];
  const labourRows: (typeof s.labourLogs.$inferInsert)[] = [];
  const txnRows: (typeof s.transactions.$inferInsert)[] = [];
  const apptRows: (typeof s.appointments.$inferInsert)[] = [];
  const notifRows: (typeof s.notifications.$inferInsert)[] = [];
  const openVehicles = new Set<string>();
  const seq: Record<string, number> = {};
  const jobHistoryStart = addDays(today, -jobHistoryDays);
  const staleCutoff = addDays(today, -3); // BYD stops reporting 3 days ago → stale-data state

  const reconFor = (date: string) => (date < addDays(today, -45) ? (chance(0.97) ? "reconciled" : "disputed") : chance(0.15) ? "reconciled" : "unreconciled") as s.ReconStatus;

  for (const p of PROFILES) {
    const d = dealerBy(p.code);
    const techs = techsOf(d.id);
    const vs = vehiclesOf(d.id);
    // BYD stopped updating 3 days ago (stale-data demo): its world froze at that point.
    const pNow = p.code === "BYD" ? zonedMidnight(addDays(staleCutoff, 1)) : now;
    const variants: { type: s.JobType; perDay: number }[] = [{ type: "service", perDay: p.serviceJobsPerDay }];
    if (p.bodyShop) variants.push({ type: "bodyshop", perDay: p.bodyJobsPerDay });
    for (const { type, perDay } of variants) {
      const stages = type === "service" ? stagesSvc : stagesBody(d.id);
      for (const day of eachDay({ start: jobHistoryStart, end: today })) {
        if (p.code === "BYD" && day > staleCutoff) continue;
        const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
        const n = poisson(perDay * (dow === 0 ? 0.25 : 1));
        for (let k = 0; k < n; k++) {
          const opened = new Date(zonedMidnight(day).getTime() + between(9, 14) * HOUR);
          if (opened > pNow) continue;
          let v = pick(vs);
          for (let tries = 0; tries < 10 && openVehicles.has(v.id + type); tries++) v = pick(vs);
          if (openVehicles.has(v.id + type)) continue;
          const planned = type === "service" ? (chance(0.25) ? between(30, 96) : between(6, 30)) : between(48, 160);
          const actual = planned * (chance(0.18) ? between(1.15, 1.8) : between(0.7, 1.05));
          const promisedAt = new Date(opened.getTime() + planned * HOUR);
          const finishAt = new Date(opened.getTime() + actual * HOUR);
          const delivered = finishAt <= pNow;
          // Stage index: delivered → last; open → progress fraction across non-terminal stages
          const nonTerminal = stages.length - 1;
          const frac = delivered ? 1 : Math.min(0.999, (pNow.getTime() - opened.getTime()) / (actual * HOUR));
          const idx = delivered ? stages.length - 1 : Math.min(nonTerminal - 1, Math.floor(frac * nonTerminal));
          const stage = stages[idx];
          const workIdx = stages.findIndex((st) => ["in_progress", "denting"].includes(st.commonStage));
          const apprIdx = stages.findIndex((st) => ["estimate_approval", "approval"].includes(st.commonStage));
          const billingIdx = stages.findIndex((st) => st.commonStage === "billing");
          const readyIdx = stages.findIndex((st) => st.commonStage === "ready");
          // Open jobs lean towards technician 1 so each demo technician login has work to show.
          const tech = techs.length ? (finishAt > pNow && chance(0.5) ? techs[0] : pick(techs)) : null;
          const jobNoKey = `${type}-${p.code}-${day.slice(2, 7).replace("-", "")}`;
          seq[jobNoKey] = (seq[jobNoKey] ?? 0) + 1;
          const id = crypto.randomUUID();
          const labour = type === "service" ? p.labourPerJob * between(0.5, 1.8) : p.bodyPerJob * between(0.5, 1.6);
          const partsAmt = type === "service" ? p.partsPerJob * between(0.3, 1.9) : p.bodyPerJob * between(0.15, 0.4);
          const estimate = r2(labour + partsAmt);
          const blockedParts = !delivered && idx >= workIdx && idx < billingIdx && chance(0.3);
          const awaitingApproval = !delivered && idx === apprIdx;
          const insurer = type === "bodyshop" && chance(0.7);
          const stepMs = (finishAt.getTime() - opened.getTime()) / nonTerminal;
          const stageTime = (i: number) => new Date(opened.getTime() + stepMs * i);
          const stageEnteredAt = delivered ? finishAt : stageTime(idx);
          const job: JobIns = {
            id,
            jobNo: `${type === "service" ? "SVC" : "BSH"}-${p.code}-${day.slice(2, 7).replace("-", "")}-${String(seq[jobNoKey]).padStart(4, "0")}`,
            jobType: type, dealershipId: d.id, customerId: v.customerId, vehicleId: v.id,
            source: chance(0.6) ? "appointment" : "walk_in",
            stageCode: stage.code, commonStage: stage.commonStage, status: delivered ? "closed" : "open",
            complaint: type === "service" ? pick(COMPLAINTS) : pick(BODY_COMPLAINTS),
            odometerKm: Math.round(between(3_000, 140_000)),
            assignedToId: idx >= workIdx || delivered ? tech?.id ?? null : chance(0.5) ? tech?.id ?? null : null,
            team: type === "bodyshop" ? pick(["Team A", "Team B"]) : null,
            estimatedHours: r2(type === "service" ? between(1.2, 4) : between(6, 22)),
            estimateAmount: idx >= apprIdx || delivered ? estimate : null,
            approvedAmount: idx > apprIdx || delivered ? estimate : null,
            approvalStatus: awaitingApproval ? "pending" : idx > apprIdx || delivered ? "approved" : "not_required",
            insurerName: insurer ? pick(INSURERS) : null,
            claimRef: insurer ? `DEMO-CLM-${Math.floor(rnd() * 1e6)}` : null,
            blocker: blockedParts ? "parts" : awaitingApproval && insurer ? "insurer_approval" : "none",
            delayReason: blockedParts ? "Waiting for part from supplier (demo)" : null,
            nextAction: blockedParts ? "Chase parts ETA" : awaitingApproval ? "Follow up on approval" : null,
            promisedAt,
            expectedCompletionAt: finishAt > promisedAt && !delivered ? finishAt : null,
            invoiceRef: idx >= billingIdx || delivered ? `DEMO-INV-${type === "service" ? "S" : "B"}-${p.code}-${seq[jobNoKey]}-${day.replace(/-/g, "")}` : null,
            paymentStatus: delivered ? "paid" : idx >= readyIdx ? (chance(0.5) ? "paid" : "unpaid") : idx >= billingIdx ? "unpaid" : "unbilled",
            openedAt: opened,
            stageEnteredAt,
            completedAt: delivered ? new Date(finishAt.getTime() - stepMs * 0.5) : idx >= readyIdx ? stageTime(readyIdx) : null,
            deliveredAt: delivered ? finishAt : null,
            closedAt: delivered ? finishAt : null,
            isComeback: chance(0.02),
            createdById: advisorOf(d.id).id,
            isDemo: true,
            createdAt: opened,
            updatedAt: delivered ? finishAt : stageEnteredAt,
          };
          jobRows.push(job);
          if (!delivered) openVehicles.add(v.id + type);

          eventRows.push({ jobId: id, type: "created", toValue: stages[0].code, userId: advisorOf(d.id).id, at: opened });
          for (let i = 1; i <= idx; i++) eventRows.push({ jobId: id, type: "stage_change", fromValue: stages[i - 1].code, toValue: stages[i].code, userId: i >= workIdx && i < billingIdx ? tech?.id ?? null : advisorOf(d.id).id, at: i === stages.length - 1 ? finishAt : stageTime(i) });
          const list = type === "service" ? SERVICE_CHECKLIST : BODYSHOP_CHECKLIST;
          list.forEach((item, i) => checklistRows.push({ jobId: id, item, sequence: i, result: idx >= 1 ? (chance(0.88) ? "ok" : "attention") : "pending" }));
          const nParts = 1 + Math.floor(rnd() * 3);
          for (let i = 0; i < nParts; i++) {
            const st = delivered || idx >= billingIdx ? "issued" : blockedParts && i === 0 ? "unavailable" : idx >= workIdx ? (chance(0.7) ? "issued" : "requested") : "requested";
            partRows.push({ jobId: id, description: pick(PARTS), partNo: `DEMO-${Math.floor(rnd() * 90000 + 10000)}`, quantity: 1 + Math.floor(rnd() * 2), status: st, requestedAt: stageTime(Math.max(1, workIdx - 1)), issuedAt: st === "issued" ? stageTime(Math.max(1, workIdx)) : null });
          }
          if ((delivered || idx > workIdx) && workIdx >= 0) {
            const workDay = businessDate(stageTime(workIdx));
            if (workDay <= today) {
              const hrs = job.estimatedHours as number;
              if (type === "service") labourRows.push({ jobId: id, dealershipId: d.id, resourceType: "service_bay", workDate: workDay, hours: r2(hrs * between(0.85, 1.15)), technicianId: tech?.id ?? null, isDemo: true });
              else {
                labourRows.push({ jobId: id, dealershipId: d.id, resourceType: "body_bay", workDate: workDay, hours: r2(hrs * 0.6), technicianId: tech?.id ?? null, isDemo: true });
                const paintDay = businessDate(stageTime(stages.findIndex((st) => st.commonStage === "painting")));
                if ((delivered || idx > stages.findIndex((st) => st.commonStage === "painting")) && paintDay <= today) labourRows.push({ jobId: id, dealershipId: d.id, resourceType: "paint_booth", workDate: paintDay, hours: r2(hrs * 0.35), technicianId: tech?.id ?? null, isDemo: true });
              }
            }
          }
          if (delivered) {
            const date = businessDate(finishAt);
            const invoiceRef = job.invoiceRef!;
            const missingCost = p.code === "HYU" && chance(0.3); // demo: incomplete cost data → provisional GP
            txnRows.push({ businessDate: date, dealershipId: d.id, legalEntityId: d.legalEntityId, brandId: d.brandId, category: type === "service" ? "service_labour" : "body_shop", kind: "invoice", revenueAmount: r2(labour), taxAmount: r2(labour * 0.18), directCostAmount: missingCost ? null : r2(labour * between(0.38, 0.5)), invoiceRef, jobId: id, source: "import", sourceRef: `DEMO|${invoiceRef}|labour`, reconciliationStatus: reconFor(date), isDemo: true, createdAt: finishAt });
            txnRows.push({ businessDate: date, dealershipId: d.id, legalEntityId: d.legalEntityId, brandId: d.brandId, category: "parts", partsChannel: "workshop", kind: "invoice", revenueAmount: r2(partsAmt), taxAmount: r2(partsAmt * 0.28), directCostAmount: missingCost ? null : r2(partsAmt * between(0.7, 0.78)), invoiceRef, jobId: id, source: "import", sourceRef: `DEMO|${invoiceRef}|parts`, reconciliationStatus: reconFor(date), isDemo: true, createdAt: finishAt });
          }
          // Appointments behind appointment-sourced jobs (last 30 days)
          if (job.source === "appointment" && day >= addDays(today, -30)) {
            apptRows.push({ dealershipId: d.id, customerId: v.customerId, vehicleId: v.id, jobType: type, scheduledAt: new Date(opened.getTime() - between(0.1, 0.8) * HOUR), requestedWork: job.complaint, status: "attended", jobId: id, createdById: advisorOf(d.id).id, isDemo: true });
          }
          // Notifications for the last 3 days of activity
          if (opened >= new Date(now.getTime() - 72 * HOUR)) {
            const cust = customers.find((c) => c.id === v.customerId)!;
            const evs: s.NotificationEvent[] = ["vehicle_received"];
            if (idx > apprIdx || awaitingApproval) evs.push("approval_required");
            if (idx >= readyIdx || delivered) evs.push("vehicle_ready");
            for (const ev of evs) {
              const ch = cust.consentWhatsapp ? "whatsapp" : cust.consentSms ? "sms" : cust.consentEmail ? "email" : null;
              const failed = ch && chance(0.04);
              notifRows.push({
                event: ev, dedupeKey: `${ev}:${id}:`, dealershipId: d.id, customerId: cust.id, jobId: id, channel: ch, recipient: ch ? (ch === "email" ? cust.email : cust.phone) : null,
                body: renderTemplate(ev, { customerName: cust.name, dealershipName: d.name, jobNo: job.jobNo, registrationNo: v.registrationNo, estimateAmount: estimate }),
                status: !ch ? "skipped" : failed ? "failed" : "sent", skipReason: ch ? null : "No recorded customer consent for any channel",
                provider: ch ? (failed ? "webhook" : "console-simulated") : null, providerRef: ch && !failed ? `sim-demo-${notifRows.length}` : null,
                attempts: ch ? 1 : 0, lastError: failed ? "Webhook responded 503 (demo)" : null, lastAttemptAt: ch ? opened : null, sentAt: ch && !failed ? opened : null, isDemo: true, createdAt: opened,
              });
            }
          }
        }
      }
    }
    // Upcoming and no-show appointments
    for (let i = -20; i <= 7; i++) {
      const day = addDays(today, i);
      const n = i < 0 ? poisson(p.serviceJobsPerDay * 0.08) : poisson(p.serviceJobsPerDay * 0.5);
      for (let k = 0; k < n; k++) {
        const v = pick(vs);
        const at = new Date(zonedMidnight(day).getTime() + between(9, 17) * HOUR);
        if (i === 0 && at < now) continue;
        apptRows.push({ dealershipId: d.id, customerId: v.customerId, vehicleId: v.id, jobType: "service", scheduledAt: at, requestedWork: pick(COMPLAINTS), status: i < 0 ? "no_show" : "scheduled", createdById: advisorOf(d.id).id, isDemo: true });
      }
    }
  }

  /* Revenue lines not tied to jobs */
  log("transactions");
  const fromDay = financeFrom;
  for (const p of PROFILES) {
    const d = dealerBy(p.code);
    // Register-style lines are imported the morning after, so they run to yesterday only.
    for (const day of eachDay({ start: fromDay, end: addDays(today, -1) })) {
      if (p.code === "BYD" && day > staleCutoff) continue;
      const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
      const salesFactor = dow === 0 ? 1.3 : dow === 6 ? 1.2 : 0.9;
      const recon = reconFor(day);
      const importedAt = new Date(zonedMidnight(addDays(day, 1)).getTime() + between(7, 9) * HOUR);
      // Vehicle deliveries — one invoice line per vehicle
      const units = poisson(p.unitsPerDay * salesFactor);
      const lateMarginSqueeze = p.code === "VW" && day >= addDays(today, -40);
      for (let u = 0; u < units; u++) {
        const rev = r2(p.unitPrice * between(0.85, 1.15));
        const ref = `DEMO-VS-${p.code}-${day.replace(/-/g, "")}-${u + 1}`;
        txnRows.push({ businessDate: day, dealershipId: d.id, legalEntityId: d.legalEntityId, brandId: d.brandId, category: "vehicle_sales", kind: "invoice", revenueAmount: rev, taxAmount: r2(rev * 0.28), directCostAmount: r2(rev * (lateMarginSqueeze ? between(0.965, 0.985) : between(0.93, 0.955))), units: 1, invoiceRef: ref, source: "import", sourceRef: `DEMO|${ref}`, reconciliationStatus: recon, isDemo: true, createdAt: importedAt });
      }
      // Booking advances (excluded from revenue)
      for (let b = 0; b < poisson(p.unitsPerDay * 0.9); b++) {
        const ref = `DEMO-ADV-${p.code}-${day.replace(/-/g, "")}-${b + 1}`;
        txnRows.push({ businessDate: day, dealershipId: d.id, legalEntityId: d.legalEntityId, brandId: d.brandId, category: "vehicle_sales", kind: "booking_advance", revenueAmount: r2(Math.min(p.unitPrice * 0.1, 500_000)), directCostAmount: null, invoiceRef: ref, source: "import", sourceRef: `DEMO|${ref}`, reconciliationStatus: recon, isDemo: true, createdAt: importedAt });
      }
      // Retail parts — daily register total
      if (dow !== 0) {
        const rev = r2(p.retailPartsPerDay * between(0.6, 1.4));
        const missing = p.code === "HYU" && chance(0.3);
        const ref = `DEMO-PR-${p.code}-${day.replace(/-/g, "")}`;
        txnRows.push({ businessDate: day, dealershipId: d.id, legalEntityId: d.legalEntityId, brandId: d.brandId, category: "parts", partsChannel: "retail", kind: "invoice", revenueAmount: rev, taxAmount: r2(rev * 0.28), directCostAmount: missing ? null : r2(rev * between(0.72, 0.8)), invoiceRef: ref, source: "import", sourceRef: `DEMO|${ref}`, reconciliationStatus: recon, isDemo: true, createdAt: importedAt });
      }
      // Before job history starts: daily aggregate service / body shop lines (as if imported from registers)
      if (day < jobHistoryStart && dow !== 0) {
        const jobs = poisson(p.serviceJobsPerDay);
        if (jobs) {
          const lab = r2(jobs * p.labourPerJob * between(0.8, 1.2));
          const prt = r2(jobs * p.partsPerJob * between(0.8, 1.2));
          const ref = `DEMO-SVCREG-${p.code}-${day.replace(/-/g, "")}`;
          txnRows.push({ businessDate: day, dealershipId: d.id, legalEntityId: d.legalEntityId, brandId: d.brandId, category: "service_labour", kind: "invoice", revenueAmount: lab, directCostAmount: r2(lab * between(0.38, 0.5)), invoiceRef: ref, source: "import", sourceRef: `DEMO|${ref}|l`, reconciliationStatus: recon, isDemo: true, createdAt: importedAt });
          txnRows.push({ businessDate: day, dealershipId: d.id, legalEntityId: d.legalEntityId, brandId: d.brandId, category: "parts", partsChannel: "workshop", kind: "invoice", revenueAmount: prt, directCostAmount: r2(prt * between(0.7, 0.78)), invoiceRef: ref, source: "import", sourceRef: `DEMO|${ref}|p`, reconciliationStatus: recon, isDemo: true, createdAt: importedAt });
        }
        if (p.bodyShop) {
          const bj = poisson(p.bodyJobsPerDay);
          if (bj) {
            const rev = r2(bj * p.bodyPerJob * between(0.8, 1.2));
            const ref = `DEMO-BSREG-${p.code}-${day.replace(/-/g, "")}`;
            txnRows.push({ businessDate: day, dealershipId: d.id, legalEntityId: d.legalEntityId, brandId: d.brandId, category: "body_shop", kind: "invoice", revenueAmount: rev, directCostAmount: r2(rev * between(0.55, 0.65)), invoiceRef: ref, source: "import", sourceRef: `DEMO|${ref}`, reconciliationStatus: recon, isDemo: true, createdAt: importedAt });
          }
        }
      }
    }
  }
  // One credit note and one intercompany parts transfer (both demonstrate double-counting safeguards)
  const hon = dealerBy("HON");
  const hyu = dealerBy("HYU");
  txnRows.push({ businessDate: addDays(today, -6), dealershipId: hon.id, legalEntityId: hon.legalEntityId, brandId: hon.brandId, category: "vehicle_sales", kind: "credit_note", revenueAmount: -r2(PROFILES[0].unitPrice * 0.03), directCostAmount: 0, invoiceRef: "DEMO-CN-HON-1", notes: "Demo: post-sale discount credit note", source: "import", sourceRef: "DEMO|CN-HON-1", reconciliationStatus: "unreconciled", isDemo: true });
  txnRows.push({ businessDate: addDays(today, -9), dealershipId: hyu.id, legalEntityId: hyu.legalEntityId, brandId: hyu.brandId, category: "parts", partsChannel: "retail", kind: "intercompany", revenueAmount: 145_000, directCostAmount: 140_000, invoiceRef: "DEMO-IC-1", notes: "Demo: parts transfer to a sister entity — excluded from comparable revenue", source: "import", sourceRef: "DEMO|IC-1", reconciliationStatus: "unreconciled", isDemo: true });

  /* Targets (approved by demo finance user) — BYD has no target for the current month (coverage state) */
  log("targets");
  const tgtRows: (typeof s.targets.$inferInsert)[] = [];
  for (const p of PROFILES) {
    const d = dealerBy(p.code);
    for (const m of eachMonth({ start: fromDay, end: today })) {
      if (p.code === "BYD" && m === today.slice(0, 7)) continue;
      const [y, mm] = m.split("-").map(Number);
      const dim = daysInMonth(y, mm);
      const svcPerDay = p.serviceJobsPerDay * (p.labourPerJob + p.partsPerJob) * 1.1;
      const expected = dim * (p.unitsPerDay * p.unitPrice + svcPerDay + p.retailPartsPerDay * 0.86 + p.bodyJobsPerDay * p.bodyPerJob * 1.25);
      tgtRows.push({ dealershipId: d.id, month: m, revenueTarget: Math.round((expected * p.targetStretch * between(0.97, 1.05)) / 100_000) * 100_000, deliveriesTarget: Math.max(1, Math.round(p.unitsPerDay * dim * p.targetStretch)), approvedById: finance.id, approvedAt: new Date(`${m}-01T05:00:00Z`), isDemo: true });
    }
  }
  await db.insert(s.targets).values(tgtRows);

  /* Daily reports — Hyundai left one recent day as draft; BYD stopped 3 days ago */
  log("daily reports");
  const repRows: (typeof s.dailyReports.$inferInsert)[] = [];
  for (const p of PROFILES) {
    const d = dealerBy(p.code);
    for (const day of eachDay({ start: fyStart(today), end: addDays(today, -1) })) {
      if (p.code === "BYD" && day > staleCutoff) continue;
      const draft = p.code === "HYU" && day === addDays(today, -2);
      const at = new Date(zonedMidnight(day).getTime() + between(18.5, 21) * HOUR);
      repRows.push({
        dealershipId: d.id, businessDate: day, status: draft ? "draft" : "submitted",
        leads: poisson(p.unitsPerDay * 7 + 1), bookings: poisson(p.unitsPerDay * 1.1), bookingCancellations: poisson(p.unitsPerDay * 0.12), expectedDeliveries7d: poisson(p.unitsPerDay * 7),
        notes: null, submittedById: draft ? null : managerOf(d.id).id, submittedAt: draft ? null : at, isDemo: true, updatedAt: at,
      });
    }
  }
  await insertChunked(db, s.dailyReports, repRows);

  log(`inserting ${jobRows.length} jobs, ${txnRows.length} revenue lines`);
  await insertChunked(db, s.jobs, jobRows, 500);
  await insertChunked(db, s.jobEvents, eventRows, 2000);
  await insertChunked(db, s.jobChecklistItems, checklistRows, 2000);
  await insertChunked(db, s.jobParts, partRows, 2000);
  await insertChunked(db, s.labourLogs, labourRows, 2000);
  await insertChunked(db, s.transactions, txnRows, 1000);
  await insertChunked(db, s.appointments, apptRows, 1000);
  await insertChunked(db, s.notifications, notifRows, 1000);

  log("showroom CRM");
  const crm = await seedCrmDemo(db, { now, profiles: PROFILES, dealers, brands: allBrands, users, scopeRows, customers, vehicles, staleCutoff });

  log("done");
  return { dealerships: dealers.length, users: users.length, jobs: jobRows.length, transactions: txnRows.length, appointments: apptRows.length, notifications: notifRows.length, ...crm };
}

export { SERVICE_COMMON_STAGES, BODYSHOP_COMMON_STAGES };
