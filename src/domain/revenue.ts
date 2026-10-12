/**
 * Revenue & gross-profit rules — the double-counting safeguards (docs/KPI_DEFINITIONS.md §2).
 *
 *  R1  Amounts are ex-tax. Tax is stored separately and never counted as revenue.
 *  R2  Each revenue line belongs to exactly ONE category. A bundled service invoice is split into
 *      lines: labour/repairs → service_labour; parts → parts (channel "workshop"). Parts are therefore
 *      never counted inside service revenue as well as parts revenue.
 *  R3  Booking advances / deposits are NOT revenue (kind = booking_advance). Vehicle revenue is
 *      recognised only from invoice lines.
 *  R4  Credit notes reduce revenue (stored as negative amounts) in the period they are issued.
 *  R5  Intercompany transactions are excluded from comparable revenue (reported separately) so that
 *      group totals do not count the same activity twice across legal entities.
 *  R6  Lines are de-duplicated on (source, source_ref) by a unique index; imports skip duplicates.
 *  R7  Gross profit uses only lines whose direct cost is known. Cost coverage
 *      = revenue on lines with known cost ÷ total revenue.
 *        coverage = 100%           → GP shown as complete
 *        GP_MIN_COVERAGE ≤ cov<100% → GP shown, flagged PROVISIONAL; margin uses covered revenue
 *        coverage < GP_MIN_COVERAGE → GP withheld ("insufficient cost data")
 */
import type { RevenueCategory, TxnKind, ReconStatus } from "@/db/schema";

export const CATEGORY_LABELS: Record<RevenueCategory, string> = {
  vehicle_sales: "Vehicle sales",
  service_labour: "Service labour & repairs",
  parts: "Spare parts",
  body_shop: "Body shop",
};
export const CATEGORY_ORDER: RevenueCategory[] = ["vehicle_sales", "service_labour", "parts", "body_shop"];

export const GP_MIN_COVERAGE = Number(process.env.GP_MIN_COVERAGE ?? 0.8);

export interface RevenueLine {
  category: RevenueCategory;
  kind: TxnKind;
  revenueAmount: number;
  directCostAmount: number | null;
  partsChannel?: "retail" | "workshop" | null;
  units?: number | null;
  reconciliationStatus?: ReconStatus;
}

export function countsAsRevenue(line: Pick<RevenueLine, "kind">): boolean {
  return line.kind === "invoice" || line.kind === "credit_note";
}

export interface GrossProfit {
  status: "complete" | "provisional" | "insufficient" | "no_revenue";
  amount: number | null; // GP on covered lines
  marginPct: number | null; // GP ÷ covered revenue × 100
  coveragePct: number | null; // revenue with known cost ÷ revenue × 100
}

export interface RevenueSummary {
  total: number;
  byCategory: Record<RevenueCategory, number>;
  gpByCategory: Record<RevenueCategory, GrossProfit>;
  gp: GrossProfit;
  vehiclesDelivered: number;
  partsByChannel: { retail: number; workshop: number };
  excluded: { bookingAdvances: number; intercompany: number };
  reconciledPct: number | null;
  lineCount: number;
}

const zeroCats = (): Record<RevenueCategory, number> => ({ vehicle_sales: 0, service_labour: 0, parts: 0, body_shop: 0 });

export function grossProfit(lines: RevenueLine[], minCoverage = GP_MIN_COVERAGE): GrossProfit {
  let revenue = 0;
  let coveredRevenue = 0;
  let coveredCost = 0;
  for (const l of lines) {
    if (!countsAsRevenue(l)) continue;
    revenue += l.revenueAmount;
    if (l.directCostAmount !== null && l.directCostAmount !== undefined) {
      coveredRevenue += l.revenueAmount;
      coveredCost += signedCost(l);
    }
  }
  if (round2(revenue) === 0) return { status: "no_revenue", amount: null, marginPct: null, coveragePct: null };
  const coverage = coveredRevenue / revenue;
  const coveragePct = round1(coverage * 100);
  if (coverage < minCoverage - 1e-9 || coveredRevenue === 0) {
    return { status: "insufficient", amount: null, marginPct: null, coveragePct };
  }
  const amount = round2(coveredRevenue - coveredCost);
  return {
    status: coverage >= 1 - 1e-9 ? "complete" : "provisional",
    amount,
    marginPct: round1((amount / coveredRevenue) * 100),
    coveragePct,
  };
}

/** Credit-note cost follows the sign of revenue (a reversal reverses its cost). */
function signedCost(l: RevenueLine): number {
  const c = l.directCostAmount ?? 0;
  return l.kind === "credit_note" ? -Math.abs(c) : c;
}

export function summariseRevenue(lines: RevenueLine[], minCoverage = GP_MIN_COVERAGE): RevenueSummary {
  const byCategory = zeroCats();
  const linesByCat: Record<RevenueCategory, RevenueLine[]> = { vehicle_sales: [], service_labour: [], parts: [], body_shop: [] };
  const partsByChannel = { retail: 0, workshop: 0 };
  const excluded = { bookingAdvances: 0, intercompany: 0 };
  let total = 0;
  let reconciled = 0;
  let vehiclesDelivered = 0;
  let lineCount = 0;

  for (const l of lines) {
    if (l.kind === "booking_advance") {
      excluded.bookingAdvances += l.revenueAmount;
      continue;
    }
    if (l.kind === "intercompany") {
      excluded.intercompany += l.revenueAmount;
      continue;
    }
    lineCount++;
    total += l.revenueAmount;
    byCategory[l.category] += l.revenueAmount;
    linesByCat[l.category].push(l);
    if (l.category === "parts") partsByChannel[l.partsChannel === "workshop" ? "workshop" : "retail"] += l.revenueAmount;
    if (l.category === "vehicle_sales" && l.units) vehiclesDelivered += l.kind === "credit_note" ? -Math.abs(l.units) : l.units;
    if (l.reconciliationStatus === "reconciled") reconciled += l.revenueAmount;
  }

  const gpByCategory = Object.fromEntries(
    (Object.keys(linesByCat) as RevenueCategory[]).map((c) => [c, grossProfit(linesByCat[c], minCoverage)]),
  ) as Record<RevenueCategory, GrossProfit>;

  return {
    total: round2(total),
    byCategory: mapValues(byCategory, round2),
    gpByCategory,
    gp: grossProfit(lines, minCoverage),
    vehiclesDelivered,
    partsByChannel: { retail: round2(partsByChannel.retail), workshop: round2(partsByChannel.workshop) },
    excluded: { bookingAdvances: round2(excluded.bookingAdvances), intercompany: round2(excluded.intercompany) },
    reconciledPct: total > 0 ? round1((reconciled / total) * 100) : null,
    lineCount,
  };
}

/* ───────────── Validation for manual entry & imports ───────────── */

export interface TransactionInput {
  businessDate: string;
  category: RevenueCategory;
  kind: TxnKind;
  revenueAmount: number;
  taxAmount?: number | null;
  directCostAmount?: number | null;
  partsChannel?: "retail" | "workshop" | null;
  units?: number | null;
  invoiceRef?: string | null;
}

/** Returns a list of human-readable problems; empty = valid. Also normalises credit-note signs. */
export function validateTransaction(t: TransactionInput, today: string): { errors: string[]; normalised: TransactionInput } {
  const errors: string[] = [];
  const n: TransactionInput = { ...t };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.businessDate)) errors.push("Business date must be YYYY-MM-DD");
  else if (t.businessDate > today) errors.push("Business date cannot be in the future");
  if (!Number.isFinite(t.revenueAmount)) errors.push("Revenue amount must be a number");
  if (t.directCostAmount != null && (!Number.isFinite(t.directCostAmount) || t.directCostAmount < 0))
    errors.push("Direct cost must be a non-negative number (leave blank if unknown)");
  if (t.taxAmount != null && !Number.isFinite(t.taxAmount)) errors.push("Tax amount must be a number");

  if (t.kind === "credit_note") {
    n.revenueAmount = -Math.abs(t.revenueAmount);
    if (t.taxAmount != null) n.taxAmount = -Math.abs(t.taxAmount);
  } else if (t.revenueAmount < 0) {
    errors.push("Negative amounts must be recorded as credit notes");
  }
  if ((t.kind === "invoice" || t.kind === "credit_note") && !t.invoiceRef?.trim())
    errors.push("Invoice / credit-note reference is required");

  if (t.category === "parts") {
    if (t.partsChannel !== "retail" && t.partsChannel !== "workshop") errors.push("Parts lines must state channel: retail or workshop");
  } else if (t.partsChannel) {
    errors.push("Parts channel applies only to parts lines — split bundled invoices into separate lines");
  }
  if (t.units != null) {
    if (t.category !== "vehicle_sales") errors.push("Units apply only to vehicle sales lines");
    else if (!Number.isInteger(t.units) || t.units < 0) errors.push("Units must be a whole number");
  }
  if (t.kind === "booking_advance" && t.category !== "vehicle_sales") errors.push("Booking advances apply only to vehicle sales");
  return { errors, normalised: n };
}

/* ───────────── helpers ───────────── */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function mapValues<K extends string, V, W>(o: Record<K, V>, f: (v: V) => W): Record<K, W> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v as V)])) as Record<K, W>;
}
