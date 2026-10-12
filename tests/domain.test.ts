import { describe, it, expect } from "vitest";
import {
  resolvePeriod, businessDate, daysInclusive, eachMonth, daysOfRangeInMonth, workingDays, zonedMidnight,
  quarterStart, fyStart, PeriodError, rangeToInstants,
} from "@/domain/periods";
import { summariseRevenue, grossProfit, validateTransaction, countsAsRevenue, type RevenueLine } from "@/domain/revenue";
import {
  pct, growthPct, targetAchievementPct, targetForPeriod, jobKpis, ageingBucket, isOverdue, availableHours,
  utilisationPct, appointmentKpis, wipByStage, type JobRecord,
} from "@/domain/kpi";
import { checkTransition, defaultStages, validateStageConfig, resolveStages, effectsOfEntering, nextStage, type JobState, type StageDef } from "@/domain/workflow";
import { can, canAccessDealership, canViewJob, canMoveJob, dealershipScope, homePathFor, type Principal } from "@/domain/permissions";
import { evaluateAlerts, type DealershipSignals } from "@/domain/alerts";
import { chooseChannel, dedupeKey, isCustomerFacingDelay, renderTemplate } from "@/domain/notifications";

/* ───────────────────────── Periods / date filters ───────────────────────── */
describe("periods", () => {
  it("business date uses IST, not UTC", () => {
    // 2026-10-11 20:00 UTC = 2026-10-12 01:30 IST
    expect(businessDate(new Date("2026-10-11T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10-12");
    expect(businessDate(new Date("2026-10-11T18:00:00Z"), "Asia/Kolkata")).toBe("2026-10-11");
  });

  it("today compares with yesterday", () => {
    const p = resolvePeriod("today", "2026-10-12");
    expect([p.start, p.end, p.days]).toEqual(["2026-10-12", "2026-10-12", 1]);
    expect([p.comparison.start, p.comparison.end]).toEqual(["2026-10-11", "2026-10-11"]);
  });

  it("MTD compares with the same day-span of the previous month", () => {
    const p = resolvePeriod("mtd", "2026-10-12");
    expect([p.start, p.end]).toEqual(["2026-10-01", "2026-10-12"]);
    expect([p.comparison.start, p.comparison.end]).toEqual(["2026-09-01", "2026-09-12"]);
  });

  it("MTD comparison is capped at a shorter previous month", () => {
    const p = resolvePeriod("mtd", "2026-03-31");
    expect([p.comparison.start, p.comparison.end]).toEqual(["2026-02-01", "2026-02-28"]);
  });

  it("previous month handles year boundary", () => {
    const p = resolvePeriod("prev_month", "2026-01-15");
    expect([p.start, p.end]).toEqual(["2025-12-01", "2025-12-31"]);
    expect([p.comparison.start, p.comparison.end]).toEqual(["2025-11-01", "2025-11-30"]);
  });

  it("quarters and YTD follow the Indian financial year (April start)", () => {
    expect(quarterStart("2026-10-12", 4)).toBe("2026-10-01");
    expect(quarterStart("2026-05-20", 4)).toBe("2026-04-01");
    expect(quarterStart("2026-02-10", 4)).toBe("2026-01-01");
    expect(fyStart("2026-02-10", 4)).toBe("2025-04-01");
    expect(fyStart("2026-10-12", 4)).toBe("2026-04-01");
    const q = resolvePeriod("qtd", "2026-10-12", undefined, 4);
    expect([q.start, q.end]).toEqual(["2026-10-01", "2026-10-12"]);
    expect([q.comparison.start, q.comparison.end]).toEqual(["2026-07-01", "2026-07-12"]);
    expect(q.label).toContain("Q3 FY26-27");
    const y = resolvePeriod("ytd", "2026-10-12", undefined, 4);
    expect([y.start, y.end, y.granularity]).toEqual(["2026-04-01", "2026-10-12", "month"]);
    expect([y.comparison.start, y.comparison.end]).toEqual(["2025-04-01", "2025-10-12"]);
  });

  it("calendar-year mode works when FY_START_MONTH=1", () => {
    const y = resolvePeriod("ytd", "2026-10-12", undefined, 1);
    expect(y.start).toBe("2026-01-01");
  });

  it("custom range validates and compares with the preceding equal span", () => {
    const p = resolvePeriod("custom", "2026-10-12", { start: "2026-09-10", end: "2026-09-19" });
    expect(p.days).toBe(10);
    expect([p.comparison.start, p.comparison.end]).toEqual(["2026-08-31", "2026-09-09"]);
    expect(() => resolvePeriod("custom", "2026-10-12", { start: "2026-09-20", end: "2026-09-19" })).toThrow(PeriodError);
    expect(() => resolvePeriod("custom", "2026-10-12", { start: "2026-10-01", end: "2026-10-13" })).toThrow(/future/);
    expect(() => resolvePeriod("custom", "2026-10-12", { start: "2026-02-30", end: "2026-03-01" })).toThrow(PeriodError);
  });

  it("date helpers", () => {
    expect(daysInclusive("2026-10-01", "2026-10-12")).toBe(12);
    expect(eachMonth({ start: "2026-09-15", end: "2026-11-02" })).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(daysOfRangeInMonth({ start: "2026-09-15", end: "2026-11-02" }, "2026-09")).toBe(16);
    // 2026-10-12 is a Monday; Mon..Sat working mask
    expect(workingDays({ start: "2026-10-12", end: "2026-10-18" }, "1111110")).toBe(6);
    expect(zonedMidnight("2026-10-12", "Asia/Kolkata").toISOString()).toBe("2026-10-11T18:30:00.000Z");
    const r = rangeToInstants({ start: "2026-10-12", end: "2026-10-12" }, "Asia/Kolkata");
    expect(r.to.getTime() - r.from.getTime()).toBe(86_400_000);
  });
});

/* ───────────────────────── Revenue & double-counting safeguards ───────────────────────── */
const line = (o: Partial<RevenueLine>): RevenueLine => ({
  category: "service_labour", kind: "invoice", revenueAmount: 0, directCostAmount: null, partsChannel: null, units: null, reconciliationStatus: "unreconciled", ...o,
});

describe("revenue rules", () => {
  it("total = vehicle + service + parts + body shop, each line counted once", () => {
    const s = summariseRevenue([
      line({ category: "vehicle_sales", revenueAmount: 1_000_000, units: 1 }),
      line({ category: "service_labour", revenueAmount: 8_000 }),
      line({ category: "parts", partsChannel: "workshop", revenueAmount: 5_000 }), // parts on the same service invoice
      line({ category: "parts", partsChannel: "retail", revenueAmount: 2_000 }),
      line({ category: "body_shop", revenueAmount: 40_000 }),
    ]);
    expect(s.total).toBe(1_055_000);
    expect(s.byCategory).toEqual({ vehicle_sales: 1_000_000, service_labour: 8_000, parts: 7_000, body_shop: 40_000 });
    expect(s.partsByChannel).toEqual({ retail: 2_000, workshop: 5_000 });
    // service revenue does NOT include the workshop parts
    expect(s.byCategory.service_labour).toBe(8_000);
    expect(s.vehiclesDelivered).toBe(1);
  });

  it("booking advances are not revenue and do not count as deliveries", () => {
    const s = summariseRevenue([
      line({ category: "vehicle_sales", kind: "booking_advance", revenueAmount: 50_000 }),
      line({ category: "vehicle_sales", revenueAmount: 900_000, units: 1 }),
    ]);
    expect(s.total).toBe(900_000);
    expect(s.excluded.bookingAdvances).toBe(50_000);
    expect(s.vehiclesDelivered).toBe(1);
    expect(countsAsRevenue({ kind: "booking_advance" })).toBe(false);
  });

  it("intercompany lines are excluded from comparable revenue", () => {
    const s = summariseRevenue([
      line({ category: "parts", partsChannel: "retail", kind: "intercompany", revenueAmount: 30_000 }),
      line({ category: "parts", partsChannel: "retail", revenueAmount: 10_000 }),
    ]);
    expect(s.total).toBe(10_000);
    expect(s.excluded.intercompany).toBe(30_000);
  });

  it("credit notes reduce revenue and units", () => {
    const s = summariseRevenue([
      line({ category: "vehicle_sales", revenueAmount: 1_000_000, units: 2 }),
      line({ category: "vehicle_sales", kind: "credit_note", revenueAmount: -500_000, units: 1 }),
    ]);
    expect(s.total).toBe(500_000);
    expect(s.vehiclesDelivered).toBe(1);
  });

  it("GP complete when all costs known", () => {
    const gp = grossProfit([line({ revenueAmount: 100, directCostAmount: 60 }), line({ revenueAmount: 100, directCostAmount: 70 })]);
    expect(gp).toEqual({ status: "complete", amount: 70, marginPct: 35, coveragePct: 100 });
  });

  it("GP provisional on partial cost coverage; margin uses covered revenue only", () => {
    const gp = grossProfit([line({ revenueAmount: 900, directCostAmount: 600 }), line({ revenueAmount: 100, directCostAmount: null })], 0.8);
    expect(gp.status).toBe("provisional");
    expect(gp.amount).toBe(300);
    expect(gp.marginPct).toBe(33.3);
    expect(gp.coveragePct).toBe(90);
  });

  it("GP withheld when cost coverage is below the minimum", () => {
    const gp = grossProfit([line({ revenueAmount: 500, directCostAmount: 300 }), line({ revenueAmount: 500 })], 0.8);
    expect(gp.status).toBe("insufficient");
    expect(gp.amount).toBeNull();
    expect(gp.marginPct).toBeNull();
  });

  it("GP with no revenue is reported as such, not 0%", () => {
    expect(grossProfit([]).status).toBe("no_revenue");
  });

  it("validation: parts need a channel; bundles must be split; negatives must be credit notes", () => {
    const today = "2026-10-12";
    expect(validateTransaction({ businessDate: "2026-10-12", category: "parts", kind: "invoice", revenueAmount: 10, invoiceRef: "X" }, today).errors).toContain("Parts lines must state channel: retail or workshop");
    expect(validateTransaction({ businessDate: "2026-10-12", category: "service_labour", kind: "invoice", revenueAmount: 10, partsChannel: "workshop", invoiceRef: "X" }, today).errors[0]).toMatch(/split bundled/);
    expect(validateTransaction({ businessDate: "2026-10-12", category: "service_labour", kind: "invoice", revenueAmount: -10, invoiceRef: "X" }, today).errors[0]).toMatch(/credit notes/);
    expect(validateTransaction({ businessDate: "2026-10-13", category: "service_labour", kind: "invoice", revenueAmount: 10, invoiceRef: "X" }, today).errors[0]).toMatch(/future/);
    expect(validateTransaction({ businessDate: "2026-10-12", category: "service_labour", kind: "invoice", revenueAmount: 10 }, today).errors[0]).toMatch(/reference/);
    const cn = validateTransaction({ businessDate: "2026-10-12", category: "body_shop", kind: "credit_note", revenueAmount: 250, invoiceRef: "CN1" }, today);
    expect(cn.errors).toEqual([]);
    expect(cn.normalised.revenueAmount).toBe(-250);
  });
});

/* ───────────────────────── KPI formulas ───────────────────────── */
const H = 3_600_000;
const t0 = new Date("2026-10-12T04:30:00Z"); // 10:00 IST
const job = (o: Partial<JobRecord>): JobRecord => ({
  id: Math.random().toString(36), jobType: "service", dealershipId: "d1", status: "open", commonStage: "in_progress", blocker: "none",
  approvalStatus: "not_required", openedAt: new Date(t0.getTime() - 2 * H), promisedAt: null, expectedCompletionAt: null,
  completedAt: null, deliveredAt: null, isComeback: false, ...o,
});

describe("KPI calculations", () => {
  it("basic ratios are null-safe", () => {
    expect(pct(60, 80)).toBe(75); // brief §9 worked example: 60 of 80 bay-hours = 75%
    expect(pct(1, 0)).toBeNull();
    expect(growthPct(110, 100)).toBe(10);
    expect(growthPct(110, 0)).toBeNull();
    expect(targetAchievementPct(90, 100)).toBe(90);
    expect(targetAchievementPct(90, null)).toBeNull();
  });

  it("utilisation follows the brief's worked example", () => {
    expect(utilisationPct(60, 80)).toBe(75);
    // 4 bays × 7 productive h × 6 working days (Mon–Sat) = 168 h
    expect(availableHours({ resourceType: "service_bay", physicalUnits: 4, productiveHoursPerUnitPerDay: 7, workingDays: "1111110" }, { start: "2026-10-12", end: "2026-10-18" })).toBe(168);
  });

  it("target for period is pro-rated by days and requires approved targets for every month", () => {
    const targets = [
      { month: "2026-09", revenueTarget: 3_000_000, deliveriesTarget: 30, approved: true },
      { month: "2026-10", revenueTarget: 3_100_000, deliveriesTarget: 31, approved: true },
    ];
    expect(targetForPeriod(targets, { start: "2026-10-01", end: "2026-10-12" }, "revenueTarget")).toBe(1_200_000);
    expect(targetForPeriod(targets, { start: "2026-09-16", end: "2026-10-15" }, "deliveriesTarget")).toBe(30);
    expect(targetForPeriod([{ ...targets[1], approved: false }], { start: "2026-10-01", end: "2026-10-12" }, "revenueTarget")).toBeNull();
    expect(targetForPeriod(targets.slice(1), { start: "2026-09-30", end: "2026-10-01" }, "revenueTarget")).toBeNull();
  });

  it("ageing buckets and overdue", () => {
    expect(ageingBucket(new Date(t0.getTime() - 12 * H), t0)).toBe("0-1d");
    expect(ageingBucket(new Date(t0.getTime() - 50 * H), t0)).toBe("2-3d");
    expect(ageingBucket(new Date(t0.getTime() - 100 * H), t0)).toBe("4-7d");
    expect(ageingBucket(new Date(t0.getTime() - 200 * H), t0)).toBe("8d+");
    expect(isOverdue(job({ promisedAt: new Date(t0.getTime() - H) }), t0)).toBe(true);
    expect(isOverdue(job({ promisedAt: new Date(t0.getTime() + H) }), t0)).toBe(false);
    expect(isOverdue(job({ promisedAt: new Date(t0.getTime() - H), deliveredAt: new Date(t0.getTime() - 2 * H), status: "closed" }), t0)).toBe(false);
  });

  it("job KPIs: opened, delivered, turnaround, on-time, waiting", () => {
    const from = new Date("2026-10-11T18:30:00Z");
    const to = new Date("2026-10-12T18:30:00Z");
    const jobs = [
      job({ openedAt: new Date(t0.getTime() - 26 * H), deliveredAt: new Date(t0.getTime() - 2 * H), promisedAt: new Date(t0.getTime() - H), status: "closed" }), // delivered on time, TAT 24h
      job({ openedAt: new Date(t0.getTime() - 50 * H), deliveredAt: new Date(t0.getTime() - 2 * H), promisedAt: new Date(t0.getTime() - 4 * H), status: "closed" }), // late, TAT 48h
      job({ openedAt: new Date(t0.getTime() - 1 * H), blocker: "parts", promisedAt: new Date(t0.getTime() - 0.5 * H) }), // opened today, overdue
      job({ openedAt: new Date(t0.getTime() - 3 * H), status: "cancelled" }),
      job({ openedAt: new Date(t0.getTime() - 2 * H), approvalStatus: "pending", commonStage: "estimate_approval", isComeback: true }),
    ];
    const k = jobKpis(jobs, { from, to }, t0);
    expect(k.opened).toBe(3); // three opened on 12 Oct IST (incl. cancelled)
    expect(k.delivered).toBe(2);
    expect(k.openAtEnd).toBe(2);
    expect(k.overdueAtEnd).toBe(1);
    expect(k.avgTurnaroundHours).toBe(36);
    expect(k.onTimePct).toBe(50);
    expect(k.waiting).toEqual({ parts: 1, approval: 1, other: 0 });
    expect(k.comebackPct).toBe(33.3);
  });

  it("WIP by stage counts only open jobs", () => {
    const w = wipByStage([job({ commonStage: "painting" }), job({ commonStage: "painting", status: "closed", deliveredAt: t0 }), job({ commonStage: "denting" })], t0, ["denting", "painting"]);
    expect(w).toEqual({ denting: 1, painting: 1 });
  });

  it("appointments: attendance excludes cancelled and unresolved", () => {
    const r = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-31T00:00:00Z") };
    const k = appointmentKpis([
      { scheduledAt: new Date("2026-10-05T05:00:00Z"), status: "attended" },
      { scheduledAt: new Date("2026-10-05T06:00:00Z"), status: "no_show" },
      { scheduledAt: new Date("2026-10-05T07:00:00Z"), status: "cancelled" },
      { scheduledAt: new Date("2026-10-25T07:00:00Z"), status: "scheduled" },
    ], r);
    expect(k).toEqual({ scheduled: 3, attended: 1, noShow: 1, attendancePct: 50 });
  });
});

/* ───────────────────────── Workflow transitions ───────────────────────── */
describe("workflow", () => {
  const stages = defaultStages("service");
  const base: JobState = { jobType: "service", status: "open", stageCode: "registered", assignedToId: null, approvalStatus: "not_required", invoiceRef: null, paymentStatus: "unbilled", blocker: "none" };

  it("default configs are valid for both job types", () => {
    expect(validateStageConfig("service", stages)).toEqual([]);
    expect(validateStageConfig("bodyshop", defaultStages("bodyshop"))).toEqual([]);
  });

  it("moves forward one stage at a time; no skipping", () => {
    expect(checkTransition(stages, base, "inspection").ok).toBe(true);
    const r = checkTransition(stages, base, "in_progress");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cannot be skipped/);
  });

  it("approval gate", () => {
    const j = { ...base, stageCode: "estimate_approval", approvalStatus: "pending" as const, assignedToId: "t1" };
    expect(checkTransition(stages, j, "in_progress").reason).toMatch(/approval/);
    expect(checkTransition(stages, { ...j, approvalStatus: "declined" }, "in_progress").reason).toMatch(/declined/);
    expect(checkTransition(stages, { ...j, approvalStatus: "approved" }, "in_progress").ok).toBe(true);
  });

  it("work needs an assigned technician", () => {
    const j = { ...base, stageCode: "estimate_approval", approvalStatus: "approved" as const };
    expect(checkTransition(stages, j, "in_progress").reason).toMatch(/Assign a technician/);
  });

  it("parts blocker prevents billing; delivery needs invoice + payment status", () => {
    const qc = { ...base, stageCode: "quality_check", assignedToId: "t1", blocker: "parts" as const };
    expect(checkTransition(stages, qc, "billing").reason).toMatch(/parts/);
    const ready = { ...base, stageCode: "ready", assignedToId: "t1" };
    expect(checkTransition(stages, ready, "delivered").reason).toMatch(/invoice/);
    expect(checkTransition(stages, { ...ready, invoiceRef: "INV-1" }, "delivered").reason).toMatch(/payment/);
    expect(checkTransition(stages, { ...ready, invoiceRef: "INV-1", paymentStatus: "paid" }, "delivered").ok).toBe(true);
  });

  it("rework requires a reason; closed jobs cannot move", () => {
    const j = { ...base, stageCode: "quality_check", assignedToId: "t1" };
    expect(checkTransition(stages, j, "in_progress").reason).toMatch(/reason/);
    const r = checkTransition(stages, j, "in_progress", "QC failed: brake noise");
    expect(r.ok && r.direction).toBe("rework");
    expect(checkTransition(stages, { ...j, status: "closed" }, "billing").ok).toBe(false);
  });

  it("entering stages has the right side effects", () => {
    const by = (c: string) => stages.find((s) => s.code === c)!;
    expect(effectsOfEntering(by("inspection"), by("estimate_approval"), "forward")).toMatchObject({ approvalStatus: "pending", notify: "approval_required" });
    expect(effectsOfEntering(by("billing"), by("ready"), "forward")).toMatchObject({ setCompletedAt: true, notify: "vehicle_ready" });
    expect(effectsOfEntering(by("ready"), by("delivered"), "forward")).toMatchObject({ setDeliveredAndClose: true });
    expect(effectsOfEntering(by("quality_check"), by("in_progress"), "rework")).toMatchObject({ clearCompletedAt: true });
  });

  it("location variants: split stages map to common stages and stay comparable", () => {
    const bs = defaultStages("bodyshop");
    const custom: StageDef[] = [
      ...bs.filter((s) => s.code !== "painting"),
      { code: "primer", label: "Primer & prep", commonStage: "painting", sequence: 48 },
      { code: "booth", label: "Paint booth", commonStage: "painting", sequence: 52 },
    ];
    expect(validateStageConfig("bodyshop", custom)).toEqual([]);
    expect(nextStage(custom, "denting")!.code).toBe("primer");
    expect(nextStage(custom, "primer")!.code).toBe("booth");
    // invalid: missing a common stage, or out of order
    expect(validateStageConfig("bodyshop", bs.filter((s) => s.code !== "quality_check")).join()).toMatch(/Missing/);
    expect(validateStageConfig("bodyshop", bs.map((s) => (s.code === "painting" ? { ...s, sequence: 5 } : s))).join()).toMatch(/order|First stage/);
  });

  it("resolveStages prefers the location configuration, else the group default", () => {
    const rows = [
      ...defaultStages("service").map((s) => ({ ...s, dealershipId: null as string | null })),
      { code: "x", label: "X", commonStage: "registered" as const, sequence: 1, dealershipId: "d2" },
    ];
    expect(resolveStages(rows, "d1").length).toBe(8);
    expect(resolveStages(rows, "d2").map((r) => r.code)).toEqual(["x"]);
  });
});

/* ───────────────────────── Permissions ───────────────────────── */
describe("permissions", () => {
  const md: Principal = { id: "u-md", role: "md", dealershipIds: [] };
  const mgr: Principal = { id: "u-m", role: "dealership_manager", dealershipIds: ["d1"] };
  const adv: Principal = { id: "u-a", role: "service_advisor", dealershipIds: ["d1"] };
  const tech: Principal = { id: "u-t", role: "technician", dealershipIds: ["d1"] };
  const admin: Principal = { id: "u-ad", role: "admin", dealershipIds: [] };

  it("MD sees the group; managers only their dealership", () => {
    expect(can(md, "group.dashboard")).toBe(true);
    expect(dealershipScope(md)).toBe("all");
    expect(can(mgr, "group.dashboard")).toBe(false);
    expect(canAccessDealership(mgr, "d1")).toBe(true);
    expect(canAccessDealership(mgr, "d2")).toBe(false);
    expect(homePathFor(mgr)).toBe("/dealerships/d1");
    expect(homePathFor(md)).toBe("/group");
  });

  it("least privilege: advisors and technicians cannot see financials; admin cannot see dashboards", () => {
    expect(can(adv, "financials.view")).toBe(false);
    expect(can(tech, "financials.view")).toBe(false);
    expect(can(tech, "customers.contact")).toBe(false);
    expect(can(admin, "group.dashboard")).toBe(false);
    expect(can(admin, "financials.view")).toBe(false);
    expect(can(admin, "admin.users")).toBe(true);
    expect(can(md, "transactions.manage")).toBe(false);
  });

  it("technicians only see and move their assigned jobs, within work stages", () => {
    const mine = { dealershipId: "d1", assignedToId: "u-t" };
    const other = { dealershipId: "d1", assignedToId: "u-x" };
    expect(canViewJob(tech, mine)).toBe(true);
    expect(canViewJob(tech, other)).toBe(false);
    expect(canMoveJob(tech, mine, { fromCommon: "in_progress", toCommon: "quality_check", direction: "forward" })).toBe(true);
    expect(canMoveJob(tech, mine, { fromCommon: "quality_check", toCommon: "billing", direction: "forward" })).toBe(false);
    expect(canMoveJob(tech, mine, { fromCommon: "painting", toCommon: "denting", direction: "rework" })).toBe(false);
    expect(canMoveJob(tech, other, { fromCommon: "in_progress", toCommon: "quality_check", direction: "forward" })).toBe(false);
    expect(canMoveJob(adv, other, { fromCommon: "quality_check", toCommon: "billing", direction: "forward" })).toBe(true);
    expect(canMoveJob(adv, { dealershipId: "d2", assignedToId: null }, { fromCommon: "a", toCommon: "b", direction: "forward" })).toBe(false);
  });
});

/* ───────────────────────── Alerts ───────────────────────── */
describe("alerts", () => {
  const s: DealershipSignals = {
    dealershipId: "d1", dealershipName: "Demo Dealer", periodKey: "2026-10", periodLabel: "Month to date",
    revenue: 700, revenuePrev: 600, proRataRevenueTarget: 1000, marginPct: 10, marginPctPrev: 14,
    overdueJobs: 6, oldestOverdueDays: 2.5, utilisationPct: 98, availableHours: 100, usedHours: 98,
    waitingApprovalOverDays: 1, dailyReportMissingDates: ["2026-10-11"],
  };
  it("fires each rule with evidence and a stable fingerprint", () => {
    const a = evaluateAlerts(s);
    const codes = a.map((x) => x.ruleCode);
    expect(codes).toEqual(["revenue_below_target", "jobs_overdue", "capacity_imbalance", "revenue_up_margin_down", "approval_wait", "daily_report_missing"]);
    expect(a[0].severity).toBe("critical"); // 70% < 75%
    expect(a[0].evidence).toMatchObject({ actual: 700, proRataTarget: 1000, gap: 300 });
    expect(a[1].severity).toBe("critical");
    expect(a[0].fingerprint).toBe("revenue_below_target:d1:2026-10");
    for (const x of a) expect(x.suggestedInvestigation.length).toBeGreaterThan(10);
  });
  it("does not fire without approved targets or cost data", () => {
    const a = evaluateAlerts({ ...s, proRataRevenueTarget: null, marginPct: null, overdueJobs: 0, utilisationPct: 70, waitingApprovalOverDays: 0, dailyReportMissingDates: [] });
    expect(a).toEqual([]);
  });
});

/* ───────────────────────── Notifications ───────────────────────── */
describe("notification rules", () => {
  const c = { name: "A", phone: "+919800000000", email: "a@example.com", preferredChannel: "whatsapp" as const, consentWhatsapp: true, consentSms: true, consentEmail: false };
  it("prefers the preferred consented channel, falls back by consent and provider availability", () => {
    expect(chooseChannel(c, ["whatsapp", "sms", "email"])).toEqual({ channel: "whatsapp", recipient: "+919800000000" });
    expect(chooseChannel(c, ["sms", "email"])).toEqual({ channel: "sms", recipient: "+919800000000" });
    expect(chooseChannel(c, ["email"])).toMatchObject({ channel: null });
    expect(chooseChannel({ ...c, consentWhatsapp: false, consentSms: false }, ["whatsapp"])).toMatchObject({ channel: null, skipReason: expect.stringMatching(/consent/) });
  });
  it("dedupe and delay semantics", () => {
    expect(dedupeKey("vehicle_ready", { jobId: "j1" })).toBe("vehicle_ready:j1:");
    expect(isCustomerFacingDelay(new Date("2026-10-12T10:00:00Z"), new Date("2026-10-13T10:00:00Z"))).toBe(true);
    expect(isCustomerFacingDelay(new Date("2026-10-12T10:00:00Z"), new Date("2026-10-12T09:00:00Z"))).toBe(false);
    expect(isCustomerFacingDelay(null, new Date())).toBe(false);
  });
  it("templates include the job reference", () => {
    expect(renderTemplate("vehicle_ready", { customerName: "A", dealershipName: "D", jobNo: "SVC-1", registrationNo: "TN01" })).toContain("SVC-1");
  });
});
