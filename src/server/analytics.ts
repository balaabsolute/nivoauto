/**
 * Analytics: loads stored records for a scope + period and computes every dashboard figure through
 * the shared, tested domain layer. Nothing here is hard-coded per dealership.
 */
import { and, eq, gte, inArray, lt, lte, or, sql, max, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  dealerships, brands, legalEntities, transactions, jobs, jobParts, labourLogs, capacityProfiles, dailyReports, targets, appointments, alerts as alertsTable, users,
  type RevenueCategory,
} from "@/db/schema";
import {
  resolvePeriod, rangeToInstants, periodRangeLabel, eachDay, eachMonth, addDays, businessDate, monthKey, daysInMonth, workingDays, type Period, type DateRange,
} from "@/domain/periods";
import { summariseRevenue, CATEGORY_ORDER, type RevenueSummary, type RevenueLine, round2 } from "@/domain/revenue";
import {
  jobKpis, wipByStage, isOpenAt as isOpenAtFn, availableHours, utilisationPct, targetForPeriod, growthPct, targetAchievementPct, appointmentKpis, averagePerJob, isOverdue, ageDays, pct,
  type JobKpis, type JobRecord, type MonthlyTarget,
} from "@/domain/kpi";
import { SERVICE_COMMON_STAGES, BODYSHOP_COMMON_STAGES } from "@/domain/workflow";
import { evaluateAlerts, ALERT_THRESHOLDS, type AlertCandidate, type Severity } from "@/domain/alerts";
import { can, dealershipScope, ForbiddenError, type Capability } from "@/domain/permissions";
import type { Actor } from "./principal";
import { demoFilter, DATA_MODE } from "./data-mode";

export const STALE_AFTER_HOURS = Number(process.env.STALE_AFTER_HOURS ?? 36);

export interface DealerInfo {
  id: string;
  code: string;
  name: string;
  brand: string;
  legalEntity: string;
  legalEntityCode: string;
  location: string;
  city: string | null;
  hasSales: boolean;
  hasService: boolean;
  hasBodyShop: boolean;
  isDemo: boolean;
}

export interface Freshness {
  lastTransactionAt: Date | null;
  lastJobActivityAt: Date | null;
  lastDailyReportDate: string | null;
  stale: boolean;
  linesMissingCost: number;
  unreconciledLines: number;
  unreconciledAmount: number;
  openJobsWithoutPromise: number;
  dailyReportsSubmitted: number;
  dailyReportsExpected: number;
  hasAnyData: boolean;
}

export interface CapacityMetric {
  available: number;
  used: number;
  utilisationPct: number | null;
  units: number;
  completedThrough: string | null; // last completed day included (null = no completed day in period)
}

export interface UnitMetrics {
  revenue: RevenueSummary;
  revenuePrev: RevenueSummary;
  revenueGrowthPct: number | null;
  revenueTarget: number | null; // pro-rata approved target
  revenueTargetCoverage: { withTarget: number; total: number };
  revenueTargetAchievementPct: number | null;
  deliveriesTarget: number | null;
  deliveriesAchievementPct: number | null;
  service: JobKpis;
  servicePrev: JobKpis;
  bodyshop: JobKpis;
  bodyshopPrev: JobKpis;
  serviceWip: Record<string, number>;
  bodyshopWip: Record<string, number>;
  appointments: ReturnType<typeof appointmentKpis>;
  capacity: {
    service: CapacityMetric;
    paint: CapacityMetric;
    body: CapacityMetric;
  };
  parts: { retail: number; workshop: number; linesIssued: number; jobsDelayedByParts: number };
  serviceRevenuePerJob: number | null;
  bodyshopRevenuePerJob: number | null;
  pipeline: { leads: number | null; bookings: number | null; cancellations: number | null; expectedDeliveries7d: number | null; reportsSubmitted: number; reportsExpected: number };
  freshness: Freshness;
}

export interface DealerRow extends UnitMetrics {
  dealer: DealerInfo;
  alerts: AlertView[];
  signal: Severity | "ok" | "no_data";
}

export interface TrendPoint {
  label: string;
  key: string;
  current: number | null;
  comparison: number | null;
  target: number | null;
}

export interface AlertView extends AlertCandidate {
  id: string;
  dealershipName: string | null;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
}

export interface Dashboard {
  period: Period;
  trendPeriod: Period;
  generatedAt: Date;
  asOf: Date;
  dataMode: typeof DATA_MODE;
  containsDemo: boolean;
  dealers: DealerRow[];
  total: UnitMetrics;
  trend: TrendPoint[];
  alerts: AlertView[];
  coverage: { dealershipsReporting: number; dealershipsTotal: number };
}

/* ───────────────────────── Loading ───────────────────────── */

export async function loadDealers(db: DB, ids: "all" | string[]): Promise<DealerInfo[]> {
  const conds: (SQL | undefined)[] = [eq(dealerships.active, true), demoFilter(dealerships.isDemo)];
  if (ids !== "all") conds.push(ids.length ? inArray(dealerships.id, ids) : sql`false`);
  const rows = await db
    .select({ d: dealerships, brand: brands.name, le: legalEntities.name, leCode: legalEntities.code })
    .from(dealerships)
    .innerJoin(brands, eq(brands.id, dealerships.brandId))
    .innerJoin(legalEntities, eq(legalEntities.id, dealerships.legalEntityId))
    .where(and(...conds))
    .orderBy(dealerships.name);
  return rows.map(({ d, brand, le, leCode }) => ({
    id: d.id, code: d.code, name: d.name, brand, legalEntity: le, legalEntityCode: leCode, location: d.locationName, city: d.city,
    hasSales: d.hasSales, hasService: d.hasService, hasBodyShop: d.hasBodyShop, isDemo: d.isDemo,
  }));
}

interface Raw {
  txns: (RevenueLine & { dealershipId: string; businessDate: string; jobId: string | null; createdAt: Date })[];
  jobs: (JobRecord & { updatedAt: Date; jobNo: string; stageEnteredAt: Date })[];
  parts: { jobId: string; status: string; issuedAt: Date | null }[];
  labour: { dealershipId: string; resourceType: string; workDate: string; hours: number }[];
  capacity: { dealershipId: string; resourceType: string; physicalUnits: number; productiveHoursPerUnitPerDay: number; workingDays: string }[];
  reports: { dealershipId: string; businessDate: string; status: string; leads: number | null; bookings: number | null; bookingCancellations: number | null; expectedDeliveries7d: number | null; availableBayHoursOverride: number | null }[];
  targets: MonthlyTarget[] & { dealershipId: string }[];
  appts: { dealershipId: string; scheduledAt: Date; status: "scheduled" | "attended" | "no_show" | "cancelled" }[];
  lastTxn: Map<string, Date>;
  lastJob: Map<string, Date>;
  lastReport: Map<string, string>;
}

async function loadRaw(db: DB, ids: string[], window: DateRange, instants: { from: Date; to: Date }): Promise<Raw> {
  if (!ids.length) {
    return { txns: [], jobs: [], parts: [], labour: [], capacity: [], reports: [], targets: [] as never, appts: [], lastTxn: new Map(), lastJob: new Map(), lastReport: new Map() };
  }
  const months = eachMonth(window);
  const [txns, jobRows, labour, capacity, reports, tgts, appts, lastTxn, lastJob, lastReport] = await Promise.all([
    db.select().from(transactions).where(and(inArray(transactions.dealershipId, ids), gte(transactions.businessDate, window.start), lte(transactions.businessDate, window.end), demoFilter(transactions.isDemo))),
    db.select().from(jobs).where(and(
      inArray(jobs.dealershipId, ids),
      lt(jobs.openedAt, instants.to),
      or(eq(jobs.status, "open"), gte(jobs.deliveredAt, instants.from), gte(jobs.closedAt, instants.from), gte(jobs.openedAt, instants.from)),
      demoFilter(jobs.isDemo),
    )),
    db.select().from(labourLogs).where(and(inArray(labourLogs.dealershipId, ids), gte(labourLogs.workDate, window.start), lte(labourLogs.workDate, window.end), demoFilter(labourLogs.isDemo))),
    db.select().from(capacityProfiles).where(and(inArray(capacityProfiles.dealershipId, ids), demoFilter(capacityProfiles.isDemo))),
    db.select().from(dailyReports).where(and(inArray(dailyReports.dealershipId, ids), gte(dailyReports.businessDate, window.start), lte(dailyReports.businessDate, window.end), demoFilter(dailyReports.isDemo))),
    db.select().from(targets).where(and(inArray(targets.dealershipId, ids), inArray(targets.month, months), demoFilter(targets.isDemo))),
    db.select().from(appointments).where(and(inArray(appointments.dealershipId, ids), gte(appointments.scheduledAt, instants.from), lt(appointments.scheduledAt, instants.to), demoFilter(appointments.isDemo))),
    db.select({ d: transactions.dealershipId, at: max(transactions.createdAt) }).from(transactions).where(and(inArray(transactions.dealershipId, ids), demoFilter(transactions.isDemo))).groupBy(transactions.dealershipId),
    db.select({ d: jobs.dealershipId, at: max(jobs.updatedAt) }).from(jobs).where(and(inArray(jobs.dealershipId, ids), demoFilter(jobs.isDemo))).groupBy(jobs.dealershipId),
    db.select({ d: dailyReports.dealershipId, at: max(dailyReports.businessDate) }).from(dailyReports).where(and(inArray(dailyReports.dealershipId, ids), eq(dailyReports.status, "submitted"), demoFilter(dailyReports.isDemo))).groupBy(dailyReports.dealershipId),
  ]);
  const jobIds = jobRows.map((j) => j.id);
  const parts = jobIds.length ? await db.select({ jobId: jobParts.jobId, status: jobParts.status, issuedAt: jobParts.issuedAt }).from(jobParts).where(inArray(jobParts.jobId, jobIds)) : [];
  return {
    txns: txns.map((t) => ({ ...t, partsChannel: t.partsChannel ?? null })),
    jobs: jobRows.map((j) => ({ ...j })),
    parts,
    labour,
    capacity,
    reports,
    targets: tgts.map((t) => ({ dealershipId: t.dealershipId, month: t.month, revenueTarget: t.revenueTarget, deliveriesTarget: t.deliveriesTarget, approved: !!t.approvedAt })) as never,
    appts,
    lastTxn: new Map(lastTxn.map((r) => [r.d, r.at!])),
    lastJob: new Map(lastJob.map((r) => [r.d, r.at!])),
    lastReport: new Map(lastReport.map((r) => [r.d, r.at!])),
  };
}

/* ───────────────────────── Computing ───────────────────────── */

function within(d: string, r: DateRange) {
  return d >= r.start && d <= r.end;
}

function computeUnit(raw: Raw, dealerIds: string[], dealersInfo: DealerInfo[], period: Period, asOf: Date, now: Date, today: string): UnitMetrics {
  const set = new Set(dealerIds);
  const P = { start: period.start, end: period.end };
  const C = period.comparison;
  const inst = rangeToInstants(P);
  const instC = rangeToInstants(C);
  const asOfC = new Date(Math.min(instC.to.getTime() - 1, now.getTime()));

  const tx = raw.txns.filter((t) => set.has(t.dealershipId));
  const cur = tx.filter((t) => within(t.businessDate, P));
  const prev = tx.filter((t) => within(t.businessDate, C));
  const revenue = summariseRevenue(cur);
  const revenuePrev = summariseRevenue(prev);

  // Targets: per dealership pro-rata; group achievement only over dealerships with approved targets.
  let tgtSum = 0;
  let actualWithTarget = 0;
  let withTarget = 0;
  let delTgtSum = 0;
  let delActualWithTarget = 0;
  let delWith = 0;
  for (const id of dealerIds) {
    const tg = (raw.targets as unknown as (MonthlyTarget & { dealershipId: string })[]).filter((t) => t.dealershipId === id);
    const rt = targetForPeriod(tg, P, "revenueTarget");
    const dRev = summariseRevenue(cur.filter((t) => t.dealershipId === id));
    if (rt != null) {
      withTarget++;
      tgtSum += rt;
      actualWithTarget += dRev.total;
    }
    const dt = targetForPeriod(tg, P, "deliveriesTarget");
    if (dt != null) {
      delWith++;
      delTgtSum += dt;
      delActualWithTarget += dRev.vehiclesDelivered;
    }
  }

  const jb = raw.jobs.filter((j) => set.has(j.dealershipId));
  const svc = jb.filter((j) => j.jobType === "service");
  const bsh = jb.filter((j) => j.jobType === "bodyshop");
  const service = jobKpis(svc, inst, asOf);
  const bodyshop = jobKpis(bsh, inst, asOf);

  // Capacity — measured over COMPLETED days only (the current day is excluded until it ends),
  // otherwise a part-day would always look under-utilised.
  const CD = completedDays(P, today);
  const lab = CD ? raw.labour.filter((l) => set.has(l.dealershipId) && within(l.workDate, CD)) : [];
  const capFor = (type: string) => {
    let available = 0;
    let units = 0;
    for (const c of raw.capacity.filter((c) => set.has(c.dealershipId) && c.resourceType === type)) {
      units += c.physicalUnits;
      if (!CD) continue;
      // Daily-report override of available service bay hours replaces the profile for that day.
      if (type === "service_bay") {
        for (const d of eachDay(CD)) {
          const ov = raw.reports.find((r) => r.dealershipId === c.dealershipId && r.businessDate === d && r.availableBayHoursOverride != null);
          available += ov ? ov.availableBayHoursOverride! : availableHours(c, { start: d, end: d });
        }
      } else available += availableHours(c, CD);
    }
    const used = round2(lab.filter((l) => l.resourceType === type).reduce((a, l) => a + l.hours, 0));
    return { available: round2(available), used, utilisationPct: utilisationPct(used, available), units, completedThrough: CD?.end ?? null };
  };

  // Parts
  const jobIdsInScope = new Set(jb.map((j) => j.id));
  const parts = raw.parts.filter((p) => jobIdsInScope.has(p.jobId));
  const linesIssued = parts.filter((p) => p.status === "issued" && p.issuedAt && p.issuedAt >= inst.from && p.issuedAt < inst.to).length;

  // Revenue per completed job (only revenue lines linked to jobs delivered in the period)
  const deliveredIds = (list: JobRecord[]) => new Set(list.filter((j) => j.deliveredAt && j.deliveredAt >= inst.from && j.deliveredAt < inst.to).map((j) => j.id));
  const svcDelivered = deliveredIds(svc);
  const bshDelivered = deliveredIds(bsh);
  const linkedRev = (ids: Set<string>) => {
    const lines = tx.filter((t) => t.jobId && ids.has(t.jobId) && (t.kind === "invoice" || t.kind === "credit_note"));
    return { revenue: lines.reduce((a, t) => a + t.revenueAmount, 0), jobs: new Set(lines.map((l) => l.jobId)).size };
  };
  const sl = linkedRev(svcDelivered);
  const bl = linkedRev(bshDelivered);

  // Pipeline from submitted daily reports
  const reps = raw.reports.filter((r) => set.has(r.dealershipId) && within(r.businessDate, P) && r.status === "submitted");
  const sumOrNull = (k: "leads" | "bookings" | "bookingCancellations") => (reps.some((r) => r[k] != null) ? reps.reduce((a, r) => a + (r[k] ?? 0), 0) : null);
  const salesDealers = dealersInfo.filter((d) => set.has(d.id) && d.hasSales);
  const expectedDays = eachDay({ start: P.start, end: P.end < today ? P.end : addDays(today, -1) }).filter((d) => d >= P.start);
  const reportsExpected = salesDealers.length * expectedDays.length;
  const reportsSubmitted = reps.filter((r) => salesDealers.some((d) => d.id === r.dealershipId) && expectedDays.includes(r.businessDate)).length;
  // Latest expected-deliveries figure per dealership (it is a forward-looking snapshot, not additive across days)
  let expDel: number | null = null;
  for (const d of salesDealers) {
    const latest = reps.filter((r) => r.dealershipId === d.id && r.expectedDeliveries7d != null).sort((a, b) => b.businessDate.localeCompare(a.businessDate))[0];
    if (latest) expDel = (expDel ?? 0) + latest.expectedDeliveries7d!;
  }

  // Freshness / completeness
  const lastTxn = maxDate(dealerIds.map((id) => raw.lastTxn.get(id)));
  const lastJob = maxDate(dealerIds.map((id) => raw.lastJob.get(id)));
  const lastRep = dealerIds.map((id) => raw.lastReport.get(id)).filter(Boolean).sort().pop() ?? null;
  const latestActivity = maxDate([lastTxn, lastJob]);
  const unrec = cur.filter((t) => t.reconciliationStatus !== "reconciled" && (t.kind === "invoice" || t.kind === "credit_note"));
  const freshness: Freshness = {
    lastTransactionAt: lastTxn,
    lastJobActivityAt: lastJob,
    lastDailyReportDate: lastRep,
    stale: !latestActivity || now.getTime() - latestActivity.getTime() > STALE_AFTER_HOURS * 3_600_000,
    linesMissingCost: cur.filter((t) => t.directCostAmount == null && (t.kind === "invoice" || t.kind === "credit_note")).length,
    unreconciledLines: unrec.length,
    unreconciledAmount: round2(unrec.reduce((a, t) => a + t.revenueAmount, 0)),
    openJobsWithoutPromise: jb.filter((j) => j.status === "open" && !j.promisedAt).length,
    dailyReportsSubmitted: reportsSubmitted,
    dailyReportsExpected: reportsExpected,
    // "Reporting" = any record inside the selected period (not the comparison/trend window).
    hasAnyData: cur.length > 0 || jb.some((j) => (j.openedAt >= inst.from && j.openedAt < inst.to) || (j.deliveredAt && j.deliveredAt >= inst.from && j.deliveredAt < inst.to) || isOpenAtFn(j, asOf)) || reps.length > 0,
  };

  return {
    revenue,
    revenuePrev,
    revenueGrowthPct: growthPct(revenue.total, revenuePrev.lineCount ? revenuePrev.total : null),
    revenueTarget: withTarget ? round2(tgtSum) : null,
    revenueTargetCoverage: { withTarget, total: dealerIds.length },
    revenueTargetAchievementPct: withTarget ? targetAchievementPct(actualWithTarget, tgtSum) : null,
    deliveriesTarget: delWith ? round2(delTgtSum) : null,
    deliveriesAchievementPct: delWith ? targetAchievementPct(delActualWithTarget, delTgtSum) : null,
    service,
    servicePrev: jobKpis(svc, instC, asOfC),
    bodyshop,
    bodyshopPrev: jobKpis(bsh, instC, asOfC),
    serviceWip: wipByStage(svc, asOf, SERVICE_COMMON_STAGES),
    bodyshopWip: wipByStage(bsh, asOf, BODYSHOP_COMMON_STAGES),
    appointments: appointmentKpis(raw.appts.filter((a) => set.has(a.dealershipId)), inst),
    capacity: { service: capFor("service_bay"), paint: capFor("paint_booth"), body: capFor("body_bay") },
    parts: { retail: revenue.partsByChannel.retail, workshop: revenue.partsByChannel.workshop, linesIssued, jobsDelayedByParts: service.waiting.parts + bodyshop.waiting.parts },
    serviceRevenuePerJob: averagePerJob(sl.revenue, sl.jobs),
    bodyshopRevenuePerJob: averagePerJob(bl.revenue, bl.jobs),
    pipeline: { leads: sumOrNull("leads"), bookings: sumOrNull("bookings"), cancellations: sumOrNull("bookingCancellations"), expectedDeliveries7d: expDel, reportsSubmitted, reportsExpected },
    freshness,
  };
}

/** The part of a range made of completed days (ends yesterday at the latest). Null if none. */
export function completedDays(r: DateRange, today: string): DateRange | null {
  const end = r.end < today ? r.end : addDays(today, -1);
  return end >= r.start ? { start: r.start, end } : null;
}

function maxDate(ds: (Date | null | undefined)[]): Date | null {
  const v = ds.filter((d): d is Date => !!d);
  return v.length ? new Date(Math.max(...v.map((d) => d.getTime()))) : null;
}

/** Cumulative revenue trend for the period vs comparison vs pro-rata approved target. */
function computeTrend(raw: Raw, dealerIds: string[], tp: Period, today: string): TrendPoint[] {
  const set = new Set(dealerIds);
  const lines = raw.txns.filter((t) => set.has(t.dealershipId) && (t.kind === "invoice" || t.kind === "credit_note"));
  const sumBetween = (s: string, e: string) => lines.filter((t) => t.businessDate >= s && t.businessDate <= e).reduce((a, t) => a + t.revenueAmount, 0);
  const tg = raw.targets as unknown as (MonthlyTarget & { dealershipId: string })[];
  // Only draw a target line when every dealership in scope has approved targets for the window.
  const allHaveTargets = dealerIds.length > 0 && dealerIds.every((id) => targetForPeriod(tg.filter((t) => t.dealershipId === id), tp, "revenueTarget") != null);
  const dailyTarget = (d: string) => {
    if (!allHaveTargets) return 0;
    const m = monthKey(d);
    const [y, mm] = m.split("-").map(Number);
    return tg.filter((t) => t.month === m && t.approved && set.has(t.dealershipId)).reduce((a, t) => a + (t.revenueTarget ?? 0), 0) / daysInMonth(y, mm);
  };
  const points: TrendPoint[] = [];
  if (tp.granularity === "day") {
    const days = eachDay(tp);
    const cdays = eachDay(tp.comparison);
    let cum = 0, ccum = 0, tcum = 0;
    days.forEach((d, i) => {
      cum += sumBetween(d, d);
      tcum += dailyTarget(d);
      const cd = cdays[i];
      if (cd) ccum += sumBetween(cd, cd);
      points.push({ key: d, label: `${Number(d.slice(8))}`, current: d <= today ? round2(cum) : null, comparison: cd ? round2(ccum) : null, target: allHaveTargets ? round2(tcum) : null });
    });
  } else {
    const months = eachMonth(tp);
    const cmonths = eachMonth(tp.comparison);
    let cum = 0, ccum = 0, tcum = 0;
    months.forEach((m, i) => {
      const s = m + "-01" < tp.start ? tp.start : m + "-01";
      const [y, mm] = m.split("-").map(Number);
      const me = `${m}-${String(daysInMonth(y, mm)).padStart(2, "0")}`;
      const e = me > tp.end ? tp.end : me;
      cum += sumBetween(s, e);
      for (const d of eachDay({ start: s, end: e })) tcum += dailyTarget(d);
      const cm = cmonths[i];
      if (cm) {
        const [cy, cmm] = cm.split("-").map(Number);
        const cs = cm + "-01" < tp.comparison.start ? tp.comparison.start : cm + "-01";
        const cme = `${cm}-${String(daysInMonth(cy, cmm)).padStart(2, "0")}`;
        ccum += sumBetween(cs, cme > tp.comparison.end ? tp.comparison.end : cme);
      }
      points.push({ key: m, label: new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" }), current: round2(cum), comparison: cm ? round2(ccum) : null, target: allHaveTargets ? round2(tcum) : null });
    });
  }
  return points;
}

/* ───────────────────────── Alerts ───────────────────────── */

function alertPeriodKey(p: Period): string {
  switch (p.key) {
    case "today": return `day:${p.start}`;
    case "mtd": return `month:${monthKey(p.start)}`;
    case "prev_month": return `month:${monthKey(p.start)}`;
    case "qtd": return `quarter:${p.start}`;
    case "ytd": return `fy:${p.start}`;
    default: return `custom:${p.start}:${p.end}`;
  }
}

function signalsFor(d: DealerInfo, m: UnitMetrics, raw: Raw, period: Period, asOf: Date, today: string) {
  const open = raw.jobs.filter((j) => j.dealershipId === d.id && isOverdue(j, asOf));
  const oldest = open.length ? Math.max(...open.map((j) => ageDays((j.promisedAt ?? j.expectedCompletionAt)!, asOf))) : null;
  const waitingApproval = raw.jobs.filter((j) => j.dealershipId === d.id && j.status === "open" && (j.approvalStatus === "pending" || j.blocker === "insurer_approval" || j.blocker === "customer_approval") && ageDays(j.stageEnteredAt, asOf) > ALERT_THRESHOLDS.approvalWaitDays).length; // time waiting in the current stage
  const gpOk = (g: RevenueSummary["gp"]) => (g.status === "complete" || g.status === "provisional" ? g.marginPct : null);
  // Missing daily reports: the last 3 days before today inside the period (keeps the signal actionable).
  const missing: string[] = [];
  if (d.hasSales && period.end >= addDays(today, -3)) {
    for (let i = 1; i <= 3; i++) {
      const day = addDays(today, -i);
      if (day < period.start || day > period.end) continue;
      if (!raw.reports.some((r) => r.dealershipId === d.id && r.businessDate === day && r.status === "submitted")) missing.push(day);
    }
  }
  return {
    dealershipId: d.id,
    dealershipName: d.name,
    periodKey: alertPeriodKey(period),
    periodLabel: period.key === "custom" ? periodRangeLabel(period) : period.label,
    revenuePrev: m.revenuePrev.lineCount ? m.revenuePrev.total : null,
    // Alerts compare against the target for completed days only, so a part-day never triggers "below target".
    proRataRevenueTarget: completedTarget(raw, d.id, period, today),
    revenueCompletedDays: completedRevenue(raw, d.id, period, today),
    revenue: m.revenue.total,
    marginPct: gpOk(m.revenue.gp),
    marginPctPrev: gpOk(m.revenuePrev.gp),
    overdueJobs: open.length,
    oldestOverdueDays: oldest,
    utilisationPct: m.capacity.service.utilisationPct,
    availableHours: m.capacity.service.available,
    usedHours: m.capacity.service.used,
    waitingApprovalOverDays: waitingApproval,
    dailyReportMissingDates: missing.sort(),
  };
}

function completedTarget(raw: Raw, dealerId: string, period: Period, today: string): number | null {
  const cd = completedDays(period, today);
  if (!cd) return null;
  return targetForPeriod((raw.targets as unknown as (MonthlyTarget & { dealershipId: string })[]).filter((t) => t.dealershipId === dealerId), cd, "revenueTarget");
}
function completedRevenue(raw: Raw, dealerId: string, period: Period, today: string): number {
  const cd = completedDays(period, today);
  if (!cd) return 0;
  return summariseRevenue(raw.txns.filter((t) => t.dealershipId === dealerId && within(t.businessDate, cd))).total;
}

/** Upsert fired alerts (keeps owner/status), deactivate ones that stopped firing for the same period. */
async function syncAlerts(db: DB, candidates: AlertCandidate[], dealerIds: string[], periodKey: string) {
  const now = new Date();
  for (const c of candidates) {
    await db
      .insert(alertsTable)
      .values({ ...c, evidence: c.evidence, active: true, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: alertsTable.fingerprint,
        set: { severity: c.severity, title: c.title, observedFact: c.observedFact, evidence: c.evidence, suggestedInvestigation: c.suggestedInvestigation, periodLabel: c.periodLabel, active: true, lastSeenAt: now },
      });
  }
  if (dealerIds.length) {
    const fired = candidates.map((c) => c.fingerprint);
    await db
      .update(alertsTable)
      .set({ active: false })
      .where(and(
        inArray(alertsTable.dealershipId, dealerIds),
        sql`${alertsTable.fingerprint} like ${"%:" + periodKey}`,
        fired.length ? sql`${alertsTable.fingerprint} not in (${sql.join(fired.map((f) => sql`${f}`), sql`, `)})` : sql`true`,
      ));
  }
}

/* ───────────────────────── Public API ───────────────────────── */

export interface DashboardOptions {
  dealershipIds?: string[]; // restrict to these (still intersected with the actor's scope)
  now?: Date;
  syncAlerts?: boolean;
  requires?: Capability;
}

export async function buildDashboard(db: DB, actor: Actor, period: Period, opts: DashboardOptions = {}): Promise<Dashboard> {
  if (!can(actor, opts.requires ?? "dealership.dashboard")) throw new ForbiddenError();
  const now = opts.now ?? new Date();
  const today = businessDate(now);
  const scope = dealershipScope(actor);
  let ids: "all" | string[] = scope;
  if (opts.dealershipIds) ids = scope === "all" ? opts.dealershipIds : opts.dealershipIds.filter((id) => scope.includes(id));
  const dealersInfo = await loadDealers(db, ids);
  const dealerIds = dealersInfo.map((d) => d.id);

  const trendPeriod = period.days < 7 ? resolvePeriod("mtd", period.end) : period;
  const start = [period.start, period.comparison.start, trendPeriod.start, trendPeriod.comparison.start].sort()[0];
  const window = { start, end: period.end };
  const inst = rangeToInstants(window);
  const raw = await loadRaw(db, dealerIds, window, inst);
  const periodTo = rangeToInstants(period).to;
  const asOf = new Date(Math.min(periodTo.getTime() - 1, now.getTime()));

  const rows: DealerRow[] = dealersInfo.map((d) => {
    const m = computeUnit(raw, [d.id], dealersInfo, period, asOf, now, today);
    return { ...m, dealer: d, alerts: [], signal: "ok" as const };
  });
  const total = computeUnit(raw, dealerIds, dealersInfo, period, asOf, now, today);

  // Alerts
  const candidates = rows.flatMap((r) => evaluateAlerts(signalsFor(r.dealer, r, raw, period, asOf, today)));
  if (opts.syncAlerts !== false) await syncAlerts(db, candidates, dealerIds, alertPeriodKey(period));
  const persisted = candidates.length
    ? await db.select({ a: alertsTable, ownerName: users.name }).from(alertsTable).leftJoin(users, eq(users.id, alertsTable.ownerId)).where(inArray(alertsTable.fingerprint, candidates.map((c) => c.fingerprint)))
    : [];
  const sevRank: Record<Severity, number> = { critical: 3, warning: 2, info: 1 };
  const views: AlertView[] = candidates
    .map((c) => {
      const p = persisted.find((x) => x.a.fingerprint === c.fingerprint);
      return {
        ...c,
        id: p?.a.id ?? c.fingerprint,
        dealershipName: dealersInfo.find((d) => d.id === c.dealershipId)?.name ?? null,
        status: p?.a.status ?? "open",
        ownerId: p?.a.ownerId ?? null,
        ownerName: p?.ownerName ?? null,
        dueDate: p?.a.dueDate ?? null,
      };
    })
    .sort((a, b) => sevRank[b.severity] - sevRank[a.severity]);
  for (const r of rows) {
    r.alerts = views.filter((v) => v.dealershipId === r.dealer.id);
    const active = r.alerts.filter((a) => a.status !== "resolved" && a.status !== "dismissed" && a.severity !== "info");
    r.signal = !r.freshness.hasAnyData ? "no_data" : active.length ? active.reduce<Severity>((s, a) => (sevRank[a.severity] > sevRank[s] ? a.severity : s), "info") : "ok";
  }

  return {
    period,
    trendPeriod,
    generatedAt: now,
    asOf,
    dataMode: DATA_MODE,
    containsDemo: dealersInfo.some((d) => d.isDemo),
    dealers: rows,
    total,
    trend: computeTrend(raw, dealerIds, trendPeriod, today),
    alerts: views,
    coverage: { dealershipsReporting: rows.filter((r) => r.freshness.hasAnyData).length, dealershipsTotal: rows.length },
  };
}

export { CATEGORY_ORDER, pct, workingDays };
export type { RevenueCategory };
