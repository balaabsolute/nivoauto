/**
 * Sales (showroom) and nurture KPIs — pure, tested (tests/sales-kpis.test.ts).
 * Every measure is defined for a period [from, to). See docs/KPI_DEFINITIONS.md §8b.
 */
import type { LeadStatus, Timeframe } from "@/db/schema";
import { pct, growthPct } from "./kpi";

export interface KLead {
  id: string;
  createdAt: Date;
  closedAt: Date | null;
  status: LeadStatus;
  source: string;
  consultantId: string | null;
  timeframe: Timeframe | null;
  lostToBrand: string | null;
  nurtureEligible: boolean; // open + consent today (snapshot)
}
export interface KDrive { leadId: string; completedAt: Date | null; status: string }
export interface KFollowUp { leadId: string; dueAt: Date; status: "open" | "done" | "skipped"; completedAt: Date | null; assignedToId: string | null; fromUpdate: boolean }
export interface KMessage { leadId: string | null; customerId: string; createdAt: Date; status: string }
export interface KActivity { leadId: string; type: string; at: Date; userId: string | null }
export interface KInterest { leadId: string; model: string }

export interface SalesInput {
  leads: KLead[];
  drives: KDrive[];
  followUps: KFollowUp[];
  nurtureMessages: KMessage[]; // model_update notifications
  updatesPublished: { publishedAt: Date }[];
  activities: KActivity[];
  interests: KInterest[];
  consultants: { id: string; name: string }[];
}
type Range = { from: Date; to: Date };

const HOT: Timeframe[] = ["immediate", "within_1m"];
const DAY = 86_400_000;
const inR = (d: Date | null | undefined, r: Range) => !!d && d >= r.from && d < r.to;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

function core(input: SalesInput, r: Range) {
  const created = input.leads.filter((l) => inR(l.createdAt, r));
  const closed = input.leads.filter((l) => l.status !== "open" && inR(l.closedAt, r));
  const won = closed.filter((l) => l.status === "won");
  const drivesDone = input.drives.filter((d) => d.status === "completed" && inR(d.completedAt, r));
  const createdIds = new Set(created.map((l) => l.id));
  const drivenIds = new Set(input.drives.filter((d) => d.status === "completed").map((d) => d.leadId));
  return { created, closed, won, drivesDone, testDriveRatePct: pct(created.filter((l) => drivenIds.has(l.id)).length, created.length), createdIds };
}

export function salesKpis(input: SalesInput, r: Range, cmp: Range, now = new Date()) {
  const cur = core(input, r);
  const prev = core(input, cmp);
  const count = (s: LeadStatus) => cur.closed.filter((l) => l.status === s).length;

  /* Pipeline snapshot (as of the end of the period, or now if the period includes today) */
  const at = r.to < now ? r.to : now;
  const openAt = input.leads.filter((l) => l.createdAt < at && (l.status === "open" || (l.closedAt && l.closedAt >= at)));
  const openNow = input.leads.filter((l) => l.status === "open");
  const overdueFollowUps = input.followUps.filter((f) => f.status === "open" && f.dueAt < now);

  /* Speed */
  const firstContact = new Map<string, Date>();
  for (const a of input.activities) {
    if (!["call", "visit", "message", "test_drive"].includes(a.type)) continue;
    const p = firstContact.get(a.leadId);
    if (!p || a.at < p) firstContact.set(a.leadId, a.at);
  }
  const hoursToFirstContact = cur.created.map((l) => firstContact.get(l.id)).map((d, i) => (d ? (d.getTime() - cur.created[i].createdAt.getTime()) / 3_600_000 : null)).filter((x): x is number => x != null && x >= 0);
  const daysToWin = cur.won.map((l) => (l.closedAt!.getTime() - l.createdAt.getTime()) / DAY);

  /* Follow-up discipline: follow-ups DUE in the period */
  const due = input.followUps.filter((f) => inR(f.dueAt, r));
  const dueDone = due.filter((f) => f.status === "done");
  const dueOnTime = dueDone.filter((f) => f.completedAt && f.completedAt.getTime() <= f.dueAt.getTime() + DAY);

  /* Nurture */
  const msgs = input.nurtureMessages.filter((m) => inR(m.createdAt, r));
  const sent = msgs.filter((m) => m.status === "sent");
  const reachedLeads = new Map<string, Date>();
  for (const m of sent) if (m.leadId && (!reachedLeads.has(m.leadId) || m.createdAt < reachedLeads.get(m.leadId)!)) reachedLeads.set(m.leadId, m.createdAt);
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  let engagedAfter = 0;
  let wonAfter = 0;
  for (const [leadId, t] of reachedLeads) {
    const drove = input.drives.some((d) => d.leadId === leadId && d.status === "completed" && d.completedAt && d.completedAt > t);
    const l = leadById.get(leadId);
    const w = l?.status === "won" && !!l.closedAt && l.closedAt > t;
    const touched = input.activities.some((a) => a.leadId === leadId && a.at > t && ["call", "visit", "message"].includes(a.type));
    if (drove || w || touched) engagedAfter++;
    if (w) wonAfter++;
  }
  const updateTasks = due.filter((f) => f.fromUpdate);
  const contacts = input.activities.filter((a) => inR(a.at, r) && ["call", "visit", "message"].includes(a.type));
  const optOuts = count("opted_out");

  /* Breakdowns */
  const bySource = tally(cur.created.map((l) => l.source));
  const lostBrands = tally(cur.closed.filter((l) => l.status === "lost_other_dealer").map((l) => l.lostToBrand?.trim() || "Unknown"));
  const modelRows = new Map<string, { model: string; enquiries: number; drives: number; won: number }>();
  for (const i of input.interests) {
    const l = leadById.get(i.leadId);
    if (!l) continue;
    const row = modelRows.get(i.model) ?? { model: i.model, enquiries: 0, drives: 0, won: 0 };
    if (cur.createdIds.has(l.id)) row.enquiries++;
    if (cur.drivesDone.some((d) => d.leadId === l.id)) row.drives++;
    if (cur.won.some((w) => w.id === l.id)) row.won++;
    modelRows.set(i.model, row);
  }
  const consultants = input.consultants.map((c) => {
    const mine = (l: KLead) => l.consultantId === c.id;
    const cl = cur.closed.filter(mine);
    const w = cl.filter((l) => l.status === "won").length;
    const fd = due.filter((f) => f.assignedToId === c.id);
    return {
      id: c.id,
      name: c.name,
      enquiries: cur.created.filter(mine).length,
      testDrives: cur.drivesDone.filter((d) => leadById.get(d.leadId)?.consultantId === c.id).length,
      won: w,
      closeRatePct: pct(w, cl.length),
      followUpsDue: fd.length,
      followUpsDonePct: pct(fd.filter((f) => f.status === "done").length, fd.length),
      contacts: contacts.filter((a) => a.userId === c.id).length,
      openNow: openNow.filter(mine).length,
      overdueNow: overdueFollowUps.filter((f) => f.assignedToId === c.id).length,
    };
  }).filter((c) => c.enquiries || c.won || c.openNow || c.followUpsDue);

  return {
    enquiries: cur.created.length,
    enquiriesGrowthPct: growthPct(cur.created.length, prev.created.length || null),
    testDrives: cur.drivesDone.length,
    testDrivesGrowthPct: growthPct(cur.drivesDone.length, prev.drivesDone.length || null),
    testDriveRatePct: cur.testDriveRatePct,
    won: cur.won.length,
    wonGrowthPct: growthPct(cur.won.length, prev.won.length || null),
    closed: cur.closed.length,
    closeRatePct: pct(cur.won.length, cur.closed.length),
    lostOtherDealer: count("lost_other_dealer"),
    notInterested: count("not_interested"),
    optedOut: optOuts,
    lostToCompetitionPct: pct(count("lost_other_dealer"), cur.closed.length),
    medianDaysToWin: median(daysToWin),
    medianHoursToFirstContact: median(hoursToFirstContact),
    contactedWithin24hPct: pct(hoursToFirstContact.filter((h) => h <= 24).length, cur.created.length),
    pipeline: {
      openAtEnd: openAt.length,
      hot: openNow.filter((l) => l.timeframe && HOT.includes(l.timeframe)).length,
      unassigned: openNow.filter((l) => !l.consultantId).length,
      overdueFollowUps: overdueFollowUps.length,
      noFollowUpPlanned: openNow.filter((l) => !input.followUps.some((f) => f.leadId === l.id && f.status === "open")).length,
      openNow: openNow.length,
    },
    followUps: { due: due.length, done: dueDone.length, skipped: due.filter((f) => f.status === "skipped").length, stillOpen: due.filter((f) => f.status === "open").length, completionPct: pct(dueDone.length, due.length), onTimePct: pct(dueOnTime.length, due.length) },
    nurture: {
      updatesPublished: input.updatesPublished.filter((u) => inR(u.publishedAt, r)).length,
      messagesSent: sent.length,
      messagesSkippedOrFailed: msgs.length - sent.length,
      enquiriesReached: reachedLeads.size,
      engagedAfter,
      engagedAfterPct: pct(engagedAfter, reachedLeads.size),
      wonAfter,
      callTasksDue: updateTasks.length,
      callTasksDonePct: pct(updateTasks.filter((f) => f.status === "done").length, updateTasks.length),
      contactsLogged: contacts.length,
      optOuts,
      eligibleNowPct: pct(openNow.filter((l) => l.nurtureEligible).length, openNow.length),
    },
    bySource,
    lostBrands,
    models: [...modelRows.values()].filter((m) => m.enquiries || m.drives || m.won).sort((a, b) => b.enquiries - a.enquiries || b.won - a.won),
    consultants: consultants.sort((a, b) => b.won - a.won || b.enquiries - a.enquiries),
  };
}
export type SalesKpis = ReturnType<typeof salesKpis>;

export function tally(xs: string[]) {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

/* ───────────── Lounge prospects ───────────── */

export interface KProspect {
  createdAt: Date;
  interest: "yes" | "maybe" | "no";
  timeframe: Timeframe | null;
  purchaseYear: number | null;
  budgetBand: string | null;
  serviceRating: number | null;
  status: "new" | "contacted" | "converted" | "not_now";
  marketingOk: boolean;
  currentMake: string | null;
  preferredBrands: string[];
  preferredModels: string[];
  convertedLead: { createdAt: Date; status: LeadStatus; closedAt: Date | null } | null;
  messagedAt: Date[]; // model updates sent to this prospect
}

export function prospectKpis(rows: KProspect[], r: Range, cmp: Range, todayYear: number, upgradeYears = 5) {
  const cur = rows.filter((p) => inR(p.createdAt, r));
  const prevN = rows.filter((p) => inR(p.createdAt, cmp)).length;
  const upgrade = cur.filter((p) => p.purchaseYear != null && todayYear - p.purchaseYear >= upgradeYears);
  const interested = cur.filter((p) => p.interest !== "no");
  const ready = cur.filter((p) => p.interest === "yes" && p.timeframe && ["immediate", "within_1m", "1_3m"].includes(p.timeframe));
  const crossBrand = interested.filter((p) => p.currentMake && p.preferredBrands.some((b) => b !== p.currentMake));
  const convertedInP = rows.filter((p) => p.convertedLead && inR(p.convertedLead.createdAt, r));
  const ratings = cur.map((p) => p.serviceRating).filter((x): x is number => x != null);
  const messaged = rows.filter((p) => p.messagedAt.some((d) => inR(d, r)));
  return {
    responses: cur.length,
    responsesGrowthPct: growthPct(cur.length, prevN || null),
    upgradeDue: upgrade.length,
    upgradeDuePct: pct(upgrade.length, cur.length),
    interestedNow: cur.filter((p) => p.interest === "yes").length,
    maybeLater: cur.filter((p) => p.interest === "maybe").length,
    notNow: cur.filter((p) => p.interest === "no").length,
    interestedPct: pct(interested.length, cur.length),
    readyIn3Months: ready.length,
    upgradeAndInterested: upgrade.filter((p) => p.interest !== "no").length,
    crossBrand: crossBrand.length,
    consentPct: pct(interested.filter((p) => p.marketingOk).length, interested.length),
    contactedPct: pct(interested.filter((p) => p.status === "contacted" || p.status === "converted").length, interested.length),
    convertedToEnquiry: convertedInP.length,
    conversionPct: pct(cur.filter((p) => p.status === "converted").length, interested.length),
    convertedWon: rows.filter((p) => p.convertedLead?.status === "won" && inR(p.convertedLead.closedAt, r)).length,
    prospectsMessaged: messaged.length,
    avgServiceRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    budgets: tally(interested.map((p) => p.budgetBand ?? "Not given")),
    timeframes: tally(interested.map((p) => p.timeframe ?? "Not given")),
    topModels: tally(interested.flatMap((p) => p.preferredModels)).slice(0, 8),
  };
}
export type ProspectKpis = ReturnType<typeof prospectKpis>;
