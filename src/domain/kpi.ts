/**
 * KPI calculations — pure functions over plain records (docs/KPI_DEFINITIONS.md §3–6).
 * Every function returns null rather than a misleading number when the denominator is missing.
 */
import { daysOfRangeInMonth, eachMonth, workingDays, type DateRange } from "./periods";
import { round1, round2 } from "./revenue";

export function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return round1((numerator / denominator) * 100);
}

/** Change vs a comparable previous period, in %. Null if the previous value is zero/unknown. */
export function growthPct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return round1(((current - previous) / Math.abs(previous)) * 100);
}

/** Actual ÷ approved target × 100. Null when there is no approved target. */
export function targetAchievementPct(actual: number, target: number | null | undefined): number | null {
  if (target == null || target <= 0) return null;
  return round1((actual / target) * 100);
}

export interface MonthlyTarget {
  month: string; // YYYY-MM
  revenueTarget: number | null;
  deliveriesTarget: number | null;
  approved: boolean;
}

/**
 * Target for an arbitrary period = Σ over months of (monthly target × share of that month's days
 * inside the period). Only APPROVED targets count. Returns null if any month in the period lacks an
 * approved target (we do not compare against a partial target).
 */
export function targetForPeriod(
  targets: MonthlyTarget[],
  period: DateRange,
  field: "revenueTarget" | "deliveriesTarget",
): number | null {
  let sum = 0;
  for (const m of eachMonth(period)) {
    const t = targets.find((x) => x.month === m && x.approved);
    const v = t?.[field];
    if (v == null) return null;
    const [y, mm] = m.split("-").map(Number);
    const dim = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    sum += (v * daysOfRangeInMonth(period, m)) / dim;
  }
  return round2(sum);
}

/* ───────────── Jobs ───────────── */

export interface JobRecord {
  id: string;
  jobType: "service" | "bodyshop";
  dealershipId: string;
  status: "open" | "closed" | "cancelled";
  commonStage: string;
  blocker: string;
  approvalStatus: string;
  openedAt: Date;
  promisedAt: Date | null;
  expectedCompletionAt: Date | null;
  completedAt: Date | null;
  deliveredAt: Date | null;
  isComeback: boolean;
}

export const AGEING_BUCKETS = [
  { key: "0-1d", label: "Up to 1 day", maxDays: 1 },
  { key: "2-3d", label: "1–3 days", maxDays: 3 },
  { key: "4-7d", label: "3–7 days", maxDays: 7 },
  { key: "8d+", label: "Over 7 days", maxDays: Infinity },
] as const;
export type AgeingKey = (typeof AGEING_BUCKETS)[number]["key"];

const DAY_MS = 86_400_000;

export function ageDays(openedAt: Date, asOf: Date): number {
  return Math.max(0, (asOf.getTime() - openedAt.getTime()) / DAY_MS);
}

export function ageingBucket(openedAt: Date, asOf: Date): AgeingKey {
  const d = ageDays(openedAt, asOf);
  return AGEING_BUCKETS.find((b) => d <= b.maxDays)!.key;
}

/** Open as at `asOf`: opened on/before asOf and not delivered/closed/cancelled by then. */
export function isOpenAt(j: JobRecord, asOf: Date): boolean {
  if (j.openedAt > asOf) return false;
  if (j.status === "cancelled") return false; // cancellation time not tracked separately; treat as not open
  if (j.deliveredAt && j.deliveredAt <= asOf) return false;
  return true;
}

/** Overdue: open and past the promised delivery time (falls back to expected completion if no promise). */
export function isOverdue(j: JobRecord, asOf: Date): boolean {
  const due = j.promisedAt ?? j.expectedCompletionAt;
  return isOpenAt(j, asOf) && !!due && due < asOf;
}

export interface JobKpis {
  opened: number;
  delivered: number;
  openAtEnd: number;
  overdueAtEnd: number;
  ageing: Record<AgeingKey, number>;
  avgTurnaroundHours: number | null; // opened → delivered, for jobs delivered in the period
  onTimePct: number | null; // delivered by promised time ÷ delivered with a promise
  onTimeBase: number;
  comebackPct: number | null;
  waiting: { parts: number; approval: number; other: number };
}

/**
 * @param range  instants [from, to) for the period
 * @param asOf   "now" for point-in-time measures (min(now, period end))
 */
export function jobKpis(jobs: JobRecord[], range: { from: Date; to: Date }, asOf: Date): JobKpis {
  const inRange = (d: Date | null) => !!d && d >= range.from && d < range.to;
  const opened = jobs.filter((j) => inRange(j.openedAt));
  const delivered = jobs.filter((j) => j.status !== "cancelled" && inRange(j.deliveredAt));
  const open = jobs.filter((j) => isOpenAt(j, asOf));

  const ageing = { "0-1d": 0, "2-3d": 0, "4-7d": 0, "8d+": 0 } as Record<AgeingKey, number>;
  for (const j of open) ageing[ageingBucket(j.openedAt, asOf)]++;

  const tat = delivered.map((j) => (j.deliveredAt!.getTime() - j.openedAt.getTime()) / 3_600_000);
  const promised = delivered.filter((j) => j.promisedAt);
  const onTime = promised.filter((j) => j.deliveredAt! <= j.promisedAt!);

  const waiting = { parts: 0, approval: 0, other: 0 };
  for (const j of open) {
    if (j.blocker === "parts") waiting.parts++;
    else if (j.blocker === "customer_approval" || j.blocker === "insurer_approval" || j.approvalStatus === "pending") waiting.approval++;
    else if (j.blocker !== "none") waiting.other++;
  }

  return {
    opened: opened.length,
    delivered: delivered.length,
    openAtEnd: open.length,
    overdueAtEnd: open.filter((j) => isOverdue(j, asOf)).length,
    ageing,
    avgTurnaroundHours: tat.length ? round1(tat.reduce((a, b) => a + b, 0) / tat.length) : null,
    onTimePct: pct(onTime.length, promised.length),
    onTimeBase: promised.length,
    comebackPct: pct(opened.filter((j) => j.isComeback).length, opened.length),
    waiting,
  };
}

/** Count open jobs per common stage (body shop WIP queue, service stage queue). */
export function wipByStage(jobs: JobRecord[], asOf: Date, stages: readonly string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(stages.map((s) => [s, 0]));
  for (const j of jobs) if (isOpenAt(j, asOf) && j.commonStage in out) out[j.commonStage]++;
  return out;
}

/* ───────────── Appointments ───────────── */

export interface AppointmentRecord {
  scheduledAt: Date;
  status: "scheduled" | "attended" | "no_show" | "cancelled";
}
export function appointmentKpis(appts: AppointmentRecord[], range: { from: Date; to: Date }) {
  const inR = appts.filter((a) => a.scheduledAt >= range.from && a.scheduledAt < range.to && a.status !== "cancelled");
  const attended = inR.filter((a) => a.status === "attended").length;
  const resolved = inR.filter((a) => a.status === "attended" || a.status === "no_show").length;
  return { scheduled: inR.length, attended, noShow: inR.filter((a) => a.status === "no_show").length, attendancePct: pct(attended, resolved) };
}

/* ───────────── Capacity ───────────── */

export interface CapacityProfile {
  resourceType: string;
  physicalUnits: number;
  productiveHoursPerUnitPerDay: number;
  workingDays: string;
}

/** Available productive hours = units × productive hours/unit/day × working days in range. */
export function availableHours(p: CapacityProfile, range: DateRange): number {
  return round2(p.physicalUnits * p.productiveHoursPerUnitPerDay * workingDays(range, p.workingDays));
}

/** Utilisation = productive hours used ÷ available productive hours × 100. */
export function utilisationPct(usedHours: number, available: number): number | null {
  return pct(usedHours, available);
}

/* ───────────── Per-job revenue ───────────── */
export function averagePerJob(revenue: number, jobsCompleted: number): number | null {
  return jobsCompleted > 0 ? round2(revenue / jobsCompleted) : null;
}
