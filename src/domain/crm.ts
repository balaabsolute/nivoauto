/**
 * Showroom & sales (CRM) rules — pure and tested (tests/crm.test.ts).
 *
 *  - Four visit types at the front desk: new car enquiry, service, spare parts, body shop.
 *  - A new-car enquiry (lead) is nurtured while OPEN. It closes as one of:
 *      won               — sale done with us
 *      lost_other_dealer — bought elsewhere (record brand / model / dealer if known; may be a different car)
 *      not_interested    — customer said no
 *      opted_out         — customer asked not to be contacted (also sets the customer's marketing opt-out)
 *    Any closing outcome stops nurture for that enquiry.
 *  - Nurture messages need: open enquiry + marketing consent + no marketing opt-out + a consented channel.
 *  - Lounge feedback is open to every lounge customer; cars owned 5+ years are tagged as upgrade candidates.
 */
import type { LeadStatus, LeadStage, Timeframe, VisitType } from "@/db/schema";
import { pct } from "./kpi";

export const VISIT_LABELS: Record<VisitType, string> = {
  new_car: "New car enquiry",
  service: "Car service",
  spare_parts: "Spare parts",
  body_shop: "Body shop repairs",
};
export const VISIT_TOKEN_PREFIX: Record<VisitType, string> = { new_car: "N", service: "S", spare_parts: "P", body_shop: "B" };

export const STAGE_LABELS: Record<LeadStage, string> = {
  enquiry: "Enquiry",
  test_drive: "Test drive",
  negotiation: "Negotiation",
  booked: "Booked",
};
export const STATUS_LABELS: Record<LeadStatus, string> = {
  open: "Open",
  won: "Won — sold",
  lost_other_dealer: "Bought elsewhere",
  not_interested: "Not interested",
  opted_out: "Opted out",
};
export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  immediate: "Immediately",
  within_1m: "Within a month",
  "1_3m": "1–3 months",
  "3_6m": "3–6 months",
  "6_12m": "6–12 months",
  "12m_plus": "More than a year",
  not_planning: "Not planning to change",
};
export const BUDGET_LABELS: Record<string, string> = {
  under_10l: "Under ₹10 L",
  "10_15l": "₹10–15 L",
  "15_25l": "₹15–25 L",
  "25_50l": "₹25–50 L",
  "50l_1cr": "₹50 L – ₹1 Cr",
  above_1cr: "Above ₹1 Cr",
};
export const UPGRADE_AGE_YEARS = Number(process.env.UPGRADE_AGE_YEARS ?? 5);

/* ───────────── Tokens ───────────── */

export function formatToken(type: VisitType, seq: number): string {
  return `${VISIT_TOKEN_PREFIX[type]}-${String(seq).padStart(3, "0")}`;
}

/* ───────────── Lead lifecycle ───────────── */

export interface CloseInput {
  status: Exclude<LeadStatus, "open">;
  reason?: string | null;
  lostToBrand?: string | null;
  lostToModel?: string | null;
  lostToDealer?: string | null;
  wonInvoiceRef?: string | null;
}

/** Validate a closing outcome. Returns problems (empty = valid). */
export function validateClose(currentStatus: LeadStatus, input: CloseInput): string[] {
  const errs: string[] = [];
  if (currentStatus !== "open") errs.push(`Enquiry is already closed (${STATUS_LABELS[currentStatus]})`);
  switch (input.status) {
    case "won":
      break;
    case "lost_other_dealer":
      if (!input.lostToBrand?.trim()) errs.push("Record which brand they bought (use “Unknown” if they didn’t say)");
      break;
    case "not_interested":
      if (!input.reason?.trim()) errs.push("Record the reason the customer gave");
      break;
    case "opted_out":
      break;
    default:
      errs.push("Unknown outcome");
  }
  return errs;
}

export function canChangeStage(status: LeadStatus, from: LeadStage, to: LeadStage): string | null {
  if (status !== "open") return "Closed enquiries can’t change stage";
  if (from === to) return "Already at this stage";
  return null;
}

/* ───────────── Nurture eligibility ───────────── */

export interface ContactProfile {
  consentMarketing: boolean;
  marketingOptOutAt: Date | null;
  consentWhatsapp: boolean;
  consentSms: boolean;
  consentEmail: boolean;
  phone: string | null;
  email: string | null;
}

export function hasMarketingPermission(c: ContactProfile): boolean {
  if (!c.consentMarketing || c.marketingOptOutAt) return false;
  return (c.consentWhatsapp && !!c.phone) || (c.consentSms && !!c.phone) || (c.consentEmail && !!c.email);
}

export type NurtureSkip = "closed" | "no_marketing_consent" | "opted_out" | "no_channel";

/** Why an enquiry would NOT receive a nurture message (null = eligible). */
export function nurtureBlocker(leadStatus: LeadStatus, c: ContactProfile): NurtureSkip | null {
  if (leadStatus !== "open") return "closed";
  if (c.marketingOptOutAt) return "opted_out";
  if (!c.consentMarketing) return "no_marketing_consent";
  if (!hasMarketingPermission(c)) return "no_channel";
  return null;
}

export interface ProspectProfile {
  interest: "yes" | "maybe" | "no";
  timeframe: Timeframe | null;
  status: "new" | "contacted" | "converted" | "not_now";
  preferredModelIds: string[];
}

/** Lounge prospects who asked about a model and are still in the market. */
export function prospectMatchesModel(p: ProspectProfile, modelId: string): boolean {
  if (p.interest === "no" || p.timeframe === "not_planning") return false;
  if (p.status === "converted" || p.status === "not_now") return false;
  return p.preferredModelIds.includes(modelId);
}

/* ───────────── Upgrade candidates ───────────── */

export function ownershipYears(purchaseYear: number | null | undefined, today: string): number | null {
  if (!purchaseYear || purchaseYear < 1950) return null;
  const y = Number(today.slice(0, 4));
  if (purchaseYear > y) return null;
  return y - purchaseYear;
}

export function isUpgradeCandidate(purchaseYear: number | null | undefined, today: string): boolean {
  const yrs = ownershipYears(purchaseYear, today);
  return yrs != null && yrs >= UPGRADE_AGE_YEARS;
}

/** Warmth score for sorting prospects: sooner timeframe, positive interest and older car rank higher. */
export function prospectScore(p: { interest: "yes" | "maybe" | "no"; timeframe: Timeframe | null; purchaseYear: number | null }, today: string): number {
  const t: Record<Timeframe, number> = { immediate: 50, within_1m: 45, "1_3m": 35, "3_6m": 25, "6_12m": 15, "12m_plus": 5, not_planning: 0 };
  let s = p.timeframe ? t[p.timeframe] : 10;
  s += p.interest === "yes" ? 30 : p.interest === "maybe" ? 15 : 0;
  const yrs = ownershipYears(p.purchaseYear, today);
  if (yrs != null) s += Math.min(20, yrs * 2);
  return s;
}

/* ───────────── Follow-up cadence (defaults to agree with Kun) ───────────── */

const H = 3_600_000;
/** Default next follow-up after an event. Times are suggestions the consultant can change. */
export function defaultFollowUpAt(event: "enquiry" | "test_drive" | "model_update", from: Date): Date {
  const hours = event === "enquiry" ? 24 : event === "test_drive" ? 48 : 24;
  return new Date(from.getTime() + hours * H);
}

/* ───────────── Funnel metrics ───────────── */

export interface FunnelLead {
  createdAt: Date;
  closedAt: Date | null;
  status: LeadStatus;
  hadTestDrive: boolean;
}
export interface FunnelInput {
  walkIns: { visitType: VisitType; createdAt: Date }[];
  leads: FunnelLead[];
  testDrivesCompleted: { completedAt: Date }[];
}

/**
 * Showroom funnel for a period [from, to):
 *  - walk-ins by visit type, enquiries created, test drives completed
 *  - outcomes CLOSED in the period (won, bought elsewhere, not interested, opted out)
 *  - close rate = won ÷ enquiries closed in the period
 *  - test-drive rate = enquiries created in the period that had a test drive ÷ enquiries created
 *  - open enquiries at period end
 */
export function funnel(input: FunnelInput, range: { from: Date; to: Date }) {
  const inR = (d: Date | null) => !!d && d >= range.from && d < range.to;
  const byType: Record<VisitType, number> = { new_car: 0, service: 0, spare_parts: 0, body_shop: 0 };
  for (const w of input.walkIns) if (inR(w.createdAt)) byType[w.visitType]++;
  const created = input.leads.filter((l) => inR(l.createdAt));
  const closed = input.leads.filter((l) => l.status !== "open" && inR(l.closedAt));
  const count = (s: LeadStatus) => closed.filter((l) => l.status === s).length;
  const won = count("won");
  const openAtEnd = input.leads.filter((l) => l.createdAt < range.to && (l.status === "open" || (l.closedAt && l.closedAt >= range.to))).length;
  return {
    walkIns: byType,
    walkInsTotal: Object.values(byType).reduce((a, b) => a + b, 0),
    enquiries: created.length,
    testDrives: input.testDrivesCompleted.filter((t) => inR(t.completedAt)).length,
    won,
    lostOtherDealer: count("lost_other_dealer"),
    notInterested: count("not_interested"),
    optedOut: count("opted_out"),
    closed: closed.length,
    closeRatePct: pct(won, closed.length),
    testDriveRatePct: pct(created.filter((l) => l.hadTestDrive).length, created.length),
    openAtEnd,
  };
}
export type Funnel = ReturnType<typeof funnel>;
