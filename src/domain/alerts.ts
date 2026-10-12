/**
 * Rule-based management alerts (brief §7). Transparent rules only — each alert states the observed
 * fact, period, source, evidence and an investigation path. Causes are never asserted.
 *
 * THRESHOLDS ARE PLACEHOLDER DEFAULTS to be agreed with Kun during discovery. They are configuration,
 * not performance targets, and can be overridden via environment variables.
 */
import { formatInr } from "./format";

export const ALERT_THRESHOLDS = {
  revenueBelowTargetWarnPct: Number(process.env.ALERT_TARGET_WARN_PCT ?? 90), // achievement of pro-rata target
  revenueBelowTargetCritPct: Number(process.env.ALERT_TARGET_CRIT_PCT ?? 75),
  overdueJobsCritCount: Number(process.env.ALERT_OVERDUE_CRIT ?? 5),
  utilisationHighPct: Number(process.env.ALERT_UTIL_HIGH ?? 95),
  utilisationLowPct: Number(process.env.ALERT_UTIL_LOW ?? 50),
  marginDropPp: Number(process.env.ALERT_MARGIN_DROP_PP ?? 2),
  approvalWaitDays: Number(process.env.ALERT_APPROVAL_WAIT_DAYS ?? 3),
};

export type Severity = "info" | "warning" | "critical";

export interface AlertCandidate {
  ruleCode: string;
  fingerprint: string;
  dealershipId: string | null;
  severity: Severity;
  title: string;
  observedFact: string;
  periodLabel: string;
  evidence: Record<string, string | number | null>;
  suggestedInvestigation: string;
  source: string;
}

export interface DealershipSignals {
  dealershipId: string;
  dealershipName: string;
  periodKey: string; // e.g. "2026-10" or "mtd:2026-10-12" — stable within the period
  periodLabel: string;
  revenue: number;
  /** Revenue over completed days only (compared with proRataRevenueTarget). Defaults to `revenue`. */
  revenueCompletedDays?: number;
  revenuePrev: number | null;
  /** Approved target pro-rated over the period's completed days. */
  proRataRevenueTarget: number | null;
  marginPct: number | null; // only complete/provisional GP
  marginPctPrev: number | null;
  overdueJobs: number;
  oldestOverdueDays: number | null;
  utilisationPct: number | null;
  availableHours: number;
  usedHours: number;
  waitingApprovalOverDays: number; // jobs waiting approval > approvalWaitDays
  dailyReportMissingDates: string[];
}

export function evaluateAlerts(s: DealershipSignals, t = ALERT_THRESHOLDS): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const base = (rule: string) => ({ ruleCode: rule, fingerprint: `${rule}:${s.dealershipId}:${s.periodKey}`, dealershipId: s.dealershipId, periodLabel: s.periodLabel });

  // 1. Revenue below target
  if (s.proRataRevenueTarget && s.proRataRevenueTarget > 0) {
    const actual = s.revenueCompletedDays ?? s.revenue;
    const ach = (actual / s.proRataRevenueTarget) * 100;
    if (ach < t.revenueBelowTargetWarnPct) {
      out.push({
        ...base("revenue_below_target"),
        severity: ach < t.revenueBelowTargetCritPct ? "critical" : "warning",
        title: "Revenue below target",
        observedFact: `${s.dealershipName}: revenue is ${ach.toFixed(1)}% of the approved target pro-rated to the last completed day (${s.periodLabel.toLowerCase()}).`,
        evidence: { actual, proRataTarget: s.proRataRevenueTarget, gap: round(s.proRataRevenueTarget - actual), achievementPct: round(ach) },
        suggestedInvestigation: "Review pending bookings, cancellations, delivery capacity, stock availability and lead conversion.",
        source: "Transactions + approved targets",
      });
    }
  }

  // 2. Service/body shop jobs overdue
  if (s.overdueJobs > 0) {
    out.push({
      ...base("jobs_overdue"),
      severity: s.overdueJobs >= t.overdueJobsCritCount ? "critical" : "warning",
      title: "Jobs past promised delivery",
      observedFact: `${s.dealershipName}: ${s.overdueJobs} open job(s) are past their promised delivery time${s.oldestOverdueDays != null ? `; oldest by ${s.oldestOverdueDays.toFixed(1)} days` : ""}.`,
      evidence: { overdueJobs: s.overdueJobs, oldestOverdueDays: s.oldestOverdueDays != null ? round(s.oldestOverdueDays) : null },
      suggestedInvestigation: "Check technician capacity, parts delays, pending approvals and stage bottlenecks for the affected jobs.",
      source: "Job cards",
    });
  }

  // 3. Capacity imbalance
  if (s.utilisationPct != null && s.availableHours > 0) {
    if (s.utilisationPct > t.utilisationHighPct || s.utilisationPct < t.utilisationLowPct) {
      const high = s.utilisationPct > t.utilisationHighPct;
      out.push({
        ...base("capacity_imbalance"),
        severity: "warning",
        title: high ? "Workshop capacity stretched" : "Workshop capacity under-used",
        observedFact: `${s.dealershipName}: bay utilisation is ${s.utilisationPct.toFixed(1)}% (${s.usedHours} of ${s.availableHours} available productive hours).`,
        evidence: { utilisationPct: s.utilisationPct, usedHours: s.usedHours, availableHours: s.availableHours },
        suggestedInvestigation: "Review demand distribution, staffing, schedules and constraints; confirm the capacity profile reflects actual operating hours.",
        source: "Labour logs + capacity profile",
      });
    }
  }

  // 4. Revenue up, margin down
  if (s.revenuePrev != null && s.revenue > s.revenuePrev && s.marginPct != null && s.marginPctPrev != null && s.marginPctPrev - s.marginPct >= t.marginDropPp) {
    out.push({
      ...base("revenue_up_margin_down"),
      severity: "warning",
      title: "Revenue up, margin down",
      observedFact: `${s.dealershipName}: revenue rose vs the comparison period while gross margin fell from ${s.marginPctPrev.toFixed(1)}% to ${s.marginPct.toFixed(1)}%.`,
      evidence: { revenue: s.revenue, revenuePrev: s.revenuePrev, marginPct: s.marginPct, marginPctPrev: s.marginPctPrev },
      suggestedInvestigation: "Review discounts, sales mix, direct costs and parts/labour margins. Confirm cost data coverage before drawing conclusions.",
      source: "Transactions (lines with known direct cost)",
    });
  }

  // 5. Approvals waiting too long
  if (s.waitingApprovalOverDays > 0) {
    out.push({
      ...base("approval_wait"),
      severity: "warning",
      title: "Jobs waiting on approval",
      observedFact: `${s.dealershipName}: ${s.waitingApprovalOverDays} job(s) have waited more than ${t.approvalWaitDays} days for customer/insurer approval.`,
      evidence: { jobs: s.waitingApprovalOverDays, thresholdDays: t.approvalWaitDays },
      suggestedInvestigation: "Follow up with the customer or insurer; check that the estimate and photos were shared.",
      source: "Job cards",
    });
  }

  // 6. Missing daily reports (data completeness)
  if (s.dailyReportMissingDates.length) {
    out.push({
      ...base("daily_report_missing"),
      severity: "info",
      title: "Daily report not submitted",
      observedFact: `${s.dealershipName}: no submitted daily report for ${s.dailyReportMissingDates.join(", ")}.`,
      evidence: { missingDays: s.dailyReportMissingDates.length, dates: s.dailyReportMissingDates.join(", ") },
      suggestedInvestigation: "Confirm the dealership data owner has submitted the daily report; sales pipeline figures are incomplete until then.",
      source: "Daily reports",
    });
  }
  return out;
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

export function describeEvidence(e: Record<string, string | number | null>): string[] {
  return Object.entries(e).map(([k, v]) => {
    const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
    const money = /actual|target|gap|revenue/i.test(k) && typeof v === "number" && !/pct/i.test(k);
    return `${label}: ${v == null ? "—" : money ? formatInr(v as number) : v}`;
  });
}
