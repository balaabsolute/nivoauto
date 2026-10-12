/**
 * DEMO DATASET — showroom CRM (walk-ins, enquiries, test drives, nurture, lounge feedback).
 *
 *  ⚠  SYNTHETIC. Customers, visit volumes, outcomes and messages are random draws from a fixed seed.
 *     Model names are the brands' public line-ups; no prices, offers or Kun figures are invented —
 *     price bands are left blank and demo "model updates" carry neutral, clearly-labelled text.
 *
 *  States created for review: today's front-desk queue (waiting / attending / done), enquiries at every
 *  stage and outcome (won, bought elsewhere — incl. a different brand, not interested, opted out),
 *  overdue and upcoming follow-ups, requested / scheduled / completed test drives, unassigned
 *  enquiries, two published model updates with call tasks, and lounge feedback with 5+ year owners.
 */
import { inArray } from "drizzle-orm";
import type { DB } from "./client";
import * as s from "./schema";
import { addDays, businessDate, eachDay, zonedMidnight } from "@/domain/periods";
import { formatToken, defaultFollowUpAt, BUDGET_RANGES, hasMarketingPermission } from "@/domain/crm";
import { renderTemplate, dedupeKey } from "@/domain/notifications";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Body type and fuel for the demo catalogue (public line-up information only). */
export const DEMO_MODEL_SPECS: Record<string, Record<string, [string, string]>> = {
  Honda: { City: ["sedan", "petrol,hybrid"], Amaze: ["sedan", "petrol"], Elevate: ["suv", "petrol"] },
  Hyundai: { Creta: ["suv", "petrol,diesel"], Venue: ["suv", "petrol,diesel"], i20: ["hatchback", "petrol"], Verna: ["sedan", "petrol"] },
  BMW: { "3 Series": ["luxury", "petrol,diesel"], X1: ["luxury", "petrol,diesel"], X5: ["luxury", "petrol,diesel"], "5 Series": ["luxury", "petrol,diesel"] },
  "Rolls-Royce": { Ghost: ["luxury", "petrol"], Cullinan: ["luxury", "petrol"] },
  Volkswagen: { Virtus: ["sedan", "petrol"], Taigun: ["suv", "petrol"], Tiguan: ["suv", "petrol"] },
  BYD: { "Atto 3": ["ev", "ev"], Seal: ["ev", "ev"], "eMAX 7": ["mpv", "ev"] },
};

export interface CrmProfile { code: string; brand: string; unitsPerDay: number; serviceJobsPerDay: number; bodyJobsPerDay: number; bodyShop: boolean; models: string[] }

const FIRST = ["Aarav", "Ishita", "Naveen", "Shalini", "Rohit", "Gayathri", "Vivek", "Keerthana", "Ashwin", "Bhavana", "Dinesh", "Farah", "Gokul", "Hema", "Imran", "Janani", "Kiran", "Lavanya", "Mohan", "Nandini"];
const LAST = ["R.", "S.", "K.", "M.", "V.", "N.", "P.", "T.", "A.", "B."];
const MASS_RIVALS = ["Kia", "Tata", "Maruti Suzuki", "Mahindra", "Toyota", "Unknown"];
const LUX_RIVALS = ["Mercedes-Benz", "Audi", "Volvo", "Unknown"];
const NOT_INTERESTED = ["Postponed the purchase", "Budget doesn’t match", "Family decided against it", "Waiting for a new model launch", "Chose to keep the current car"];
const CALL_NOTES = ["Shared brochure and variant comparison", "Discussed finance options", "Customer comparing with another brand", "Exchange valuation discussed", "Customer asked for colour availability", "Called back — will visit with family at the weekend"];
const BUDGET_BY_BRAND: Record<string, s.BudgetBand[]> = {
  Honda: ["10_15l", "15_25l"], Hyundai: ["under_10l", "10_15l", "15_25l"], BMW: ["50l_1cr", "above_1cr"], "Rolls-Royce": ["above_1cr"], Volkswagen: ["10_15l", "15_25l", "25_50l"], BYD: ["25_50l", "50l_1cr"],
};

export async function seedCrmDemo(db: DB, ctx: {
  now: Date;
  profiles: CrmProfile[];
  dealers: (typeof s.dealerships.$inferSelect)[];
  brands: (typeof s.brands.$inferSelect)[];
  users: (typeof s.users.$inferSelect)[];
  scopeRows: { userId: string; dealershipId: string }[];
  customers: (typeof s.customers.$inferSelect)[];
  vehicles: (typeof s.vehicles.$inferSelect)[];
  staleCutoff: string;
  historyDays?: number;
}) {
  const rnd = mulberry32(5_150_2026);
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const chance = (p: number) => rnd() < p;
  const poisson = (lambda: number) => {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rnd();
    } while (p > L);
    return k - 1;
  };
  const { now, profiles, dealers, users, scopeRows, staleCutoff } = ctx;
  /** Move a timestamp into showroom hours (10:00–19:00 IST), never past `limit`. */
  const biz = (d: Date, limit?: Date) => {
    const day = businessDate(d);
    const h = (d.getTime() - zonedMidnight(day).getTime()) / HOUR;
    let out = d;
    if (h < 10) out = new Date(zonedMidnight(day).getTime() + between(10, 13) * HOUR);
    else if (h > 19) out = new Date(zonedMidnight(addDays(day, 1)).getTime() + between(10, 13) * HOUR);
    return limit && out > limit ? limit : out;
  };
  const today = businessDate(now);
  const historyDays = ctx.historyDays ?? 60;
  const dealerBy = (code: string) => dealers.find((d) => d.code === code)!;
  const usersAt = (dealerId: string, role: s.Role) => users.filter((u) => u.role === role && scopeRows.some((r) => r.userId === u.id && r.dealershipId === dealerId));

  /* Catalogue */
  const modelRows = profiles.flatMap((p) => {
    const brandId = ctx.brands.find((b) => b.name === p.brand)!.id;
    return p.models.map((name, i) => {
      const [bodyType, fuelTypes] = DEMO_MODEL_SPECS[p.brand]?.[name] ?? [null, null];
      return { brandId, name, bodyType, fuelTypes, priceBand: null, sortOrder: i, active: true, isDemo: true };
    });
  });
  const models = await db.insert(s.carModels).values(modelRows).onConflictDoNothing().returning();
  const modelsOf = (brandId: string) => models.filter((m) => m.brandId === brandId);

  /* New prospect customers (enquiries) */
  const custRows: (typeof s.customers.$inferInsert)[] = [];
  const walkRows: (typeof s.walkIns.$inferInsert & { id: string })[] = [];
  const leadRows: (typeof s.leads.$inferInsert & { id: string })[] = [];
  const interestRows: (typeof s.leadInterests.$inferInsert)[] = [];
  const driveRows: (typeof s.testDrives.$inferInsert)[] = [];
  const actRows: (typeof s.leadActivities.$inferInsert)[] = [];
  const fuRows: (typeof s.followUps.$inferInsert)[] = [];
  const notifRows: (typeof s.notifications.$inferInsert)[] = [];
  const loungeRows: (typeof s.loungeFeedback.$inferInsert)[] = [];
  const marketingYes = new Set<string>();
  const tokenSeq: Record<string, number> = {};
  const leadSeq: Record<string, number> = {};
  const leadModels = new Map<string, string[]>();
  const leadCustIdx = new Map<string, number>();

  for (const p of profiles) {
    const d = dealerBy(p.code);
    const consultants = usersAt(d.id, "sales_consultant");
    const advisor = usersAt(d.id, "service_advisor")[0];
    const kiosk = usersAt(d.id, "kiosk")[0];
    const dModels = modelsOf(d.brandId);
    const pNow = p.code === "BYD" ? zonedMidnight(addDays(staleCutoff, 1)) : now;
    const enqPerDay = Math.min(7, Math.max(0.15, p.unitsPerDay * 2.2));
    const luxury = ["BMW", "Rolls-Royce"].includes(p.brand);
    const svcPool = ctx.customers.filter((c) => c.dealershipId === d.id);

    for (const day of eachDay({ start: addDays(today, -historyDays), end: today })) {
      if (p.code === "BYD" && day > staleCutoff) continue;
      const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 1.5 : 1;
      const visit = (type: s.VisitType) => {
        const at = new Date(zonedMidnight(day).getTime() + between(10, 19.5) * HOUR);
        if (at > pNow) return null;
        const key = `${d.id}|${day}|${type}`;
        tokenSeq[key] = (tokenSeq[key] ?? 0) + 1;
        const ageMin = (pNow.getTime() - at.getTime()) / 60_000;
        const status: "waiting" | "attending" | "done" | "left" = day === today && ageMin < 8 ? "waiting" : day === today && ageMin < 45 ? "attending" : chance(0.06) ? "left" : "done";
        const attendedAt = status === "waiting" || status === "left" ? null : new Date(at.getTime() + between(2, 8) * 60_000);
        return { at, token: formatToken(type, tokenSeq[key]), status, attendedAt };
      };

      /* New-car walk-ins + phone / web enquiries → leads */
      const nWalk = poisson(enqPerDay * weekend);
      const nOther = poisson(enqPerDay * 0.3);
      for (let k = 0; k < nWalk + nOther; k++) {
        const isWalk = k < nWalk;
        const v = isWalk ? visit("new_car") : null;
        const createdAt = v?.at ?? new Date(zonedMidnight(day).getTime() + between(9, 20) * HOUR);
        if (createdAt > pNow) continue;
        const wa = chance(0.85);
        const sms = chance(0.4);
        const optedOut = chance(0.03);
        const marketing = !optedOut && chance(0.65);
        custRows.push({
          legalEntityId: d.legalEntityId, dealershipId: d.id, name: `${pick(FIRST)} ${pick(LAST)} (demo)`, phone: `+9191000${String(custRows.length).padStart(5, "0")}`, email: null,
          preferredChannel: wa ? "whatsapp" : sms ? "sms" : null, consentWhatsapp: wa, consentSms: sms, consentEmail: false, consentMarketing: marketing,
          marketingOptOutAt: optedOut ? createdAt : null, consentRecordedAt: createdAt, isDemo: true, createdAt,
        });
        const custIdx = custRows.length - 1;
        const id = crypto.randomUUID();
        const ym = day.slice(2, 7).replace("-", "");
        leadSeq[`${p.code}${ym}`] = (leadSeq[`${p.code}${ym}`] ?? 0) + 1;
        const leadNo = `ENQ-${p.code}-${ym}-${String(leadSeq[`${p.code}${ym}`]).padStart(4, "0")}`;
        const ageDays = (pNow.getTime() - createdAt.getTime()) / DAY;
        const consultant = consultants.length && !(ageDays < 2 && chance(0.25)) ? pick(consultants) : null;
        const chosen = [...new Set([pick(dModels), ...(chance(0.35) ? [pick(dModels)] : [])])];
        leadModels.set(id, chosen.map((m) => m.id));
        leadCustIdx.set(id, custIdx);
        chosen.forEach((m, i) => interestRows.push({ leadId: id, modelId: m.id, isPrimary: i === 0 }));

        // Lifecycle
        const closed = ageDays > 2 && chance(Math.min(0.9, ageDays / 40));
        const closedAt = closed ? biz(new Date(createdAt.getTime() + between(2, Math.min(ageDays, 35)) * DAY), new Date(pNow.getTime() - HOUR)) : null;
        const r = rnd();
        const status: s.LeadStatus = !closed ? "open" : optedOut ? "opted_out" : r < 0.3 ? "won" : r < 0.55 ? "lost_other_dealer" : r < 0.93 ? "not_interested" : "opted_out";
        const wantsDrive = chance(isWalk ? 0.5 : 0.3);
        const driveModel = chosen[0];
        let hadDrive = false;
        if (wantsDrive) {
          const doneAt = biz(new Date(createdAt.getTime() + between(0.05, 3) * DAY));
          const limit = closedAt ?? pNow;
          if (doneAt < limit && (status !== "open" || ageDays > 1 || chance(0.5))) {
            hadDrive = true;
            driveRows.push({ leadId: id, modelId: driveModel.id, status: "completed", scheduledAt: null, completedAt: doneAt, licenceChecked: true, rating: 3 + Math.floor(rnd() * 3), notes: null, consultantId: consultant?.id ?? null, createdAt });
            actRows.push({ leadId: id, type: "test_drive", text: `Test drive completed: ${driveModel.name}`, userId: consultant?.id ?? null, at: doneAt });
          } else if (status === "open") {
            const future = chance(0.6);
            driveRows.push({ leadId: id, modelId: driveModel.id, status: future ? "scheduled" : "requested", scheduledAt: future ? new Date(zonedMidnight(addDays(today, 1 + Math.floor(rnd() * 3))).getTime() + between(10, 17) * HOUR) : null, consultantId: consultant?.id ?? null, createdAt });
          }
        }
        const stage: s.LeadStage = status === "won" ? "booked" : hadDrive ? (status === "open" && chance(0.4) ? "negotiation" : "test_drive") : "enquiry";
        const timeframe = pick(["immediate", "within_1m", "within_1m", "1_3m", "1_3m", "3_6m"] as const);
        const band = pick(BUDGET_BY_BRAND[p.brand] ?? ["10_15l"]);
        const [bMin, bMax] = BUDGET_RANGES[band];
        const lastContactAt = ageDays > 1 ? biz(new Date(createdAt.getTime() + between(0.5, Math.max(0.6, Math.min(ageDays, 10))) * DAY), closedAt ?? pNow) : null;
        const nextFollowUpAt = status === "open" ? (chance(0.25) ? biz(new Date(pNow.getTime() - between(2, 60) * HOUR), pNow) : biz(new Date(pNow.getTime() + between(2, 96) * HOUR))) : null;
        const rival = luxury ? pick(LUX_RIVALS) : pick(MASS_RIVALS);
        leadRows.push({
          id, leadNo, dealershipId: d.id, customerId: "", source: isWalk ? "walk_in" : chance(0.6) ? "phone" : "web", walkInId: null, consultantId: consultant?.id ?? null,
          stage, status, timeframe, budgetMin: bMin, budgetMax: bMax, fuelPreference: null, financeNeeded: chance(0.5) ? chance(0.6) : null,
          exchangeVehicle: chance(0.3) ? "Existing car for exchange (demo)" : null, nextFollowUpAt, lastContactAt, closedAt,
          lostToBrand: status === "lost_other_dealer" ? rival : null, lostToModel: null, lostToDealer: status === "lost_other_dealer" && rival !== "Unknown" ? "Another dealer (demo)" : null,
          closeReason: status === "not_interested" ? pick(NOT_INTERESTED) : null, wonInvoiceRef: status === "won" ? `DEMO-BK-${p.code}-${leadNo.slice(-9)}` : null,
          createdById: isWalk ? kiosk?.id ?? null : consultant?.id ?? null, isDemo: true, createdAt, updatedAt: closedAt ?? lastContactAt ?? createdAt,
        });
        actRows.push({ leadId: id, type: "created", text: isWalk ? "Showroom walk-in (kiosk)" : "Enquiry recorded", userId: isWalk ? null : consultant?.id ?? null, at: createdAt });
        if (consultant) actRows.push({ leadId: id, type: "assignment", text: `Assigned to ${consultant.name}`, userId: consultant.id, at: new Date(createdAt.getTime() + 5 * 60_000) });
        if (lastContactAt) actRows.push({ leadId: id, type: "call", text: pick(CALL_NOTES), userId: consultant?.id ?? null, at: lastContactAt });
        if (closed && closedAt) {
          const text = status === "won" ? "Sale won" : status === "lost_other_dealer" ? `Bought elsewhere: ${rival}` : status === "not_interested" ? `Not interested: ${leadRows[leadRows.length - 1].closeReason}` : "Customer asked not to be contacted — marketing opt-out recorded";
          actRows.push({ leadId: id, type: "outcome", text, userId: consultant?.id ?? null, at: closedAt });
          if (status === "opted_out" && !optedOut) {
            custRows[custIdx].consentMarketing = false;
            custRows[custIdx].marketingOptOutAt = closedAt;
          }
        }
        if (status === "open" && nextFollowUpAt) {
          fuRows.push({ leadId: id, assignedToId: consultant?.id ?? null, dueAt: nextFollowUpAt, kind: "call", reason: hadDrive ? "Follow up after test drive" : "Follow up on enquiry", createdAt });
        }
        if (v) {
          walkRows.push({
            id: crypto.randomUUID(), dealershipId: d.id, customerId: "", visitType: "new_car", token: v.token, businessDate: day, capturedVia: "kiosk", kioskUserId: kiosk?.id ?? null,
            status: v.status === "left" ? "done" : v.status, attendedById: v.attendedAt ? consultant?.id ?? null : null, attendedAt: v.attendedAt,
            closedAt: v.status === "done" || v.status === "left" ? new Date(v.at.getTime() + between(30, 90) * 60_000) : null, leadId: id, isDemo: true, createdAt: v.at,
          });
          leadRows[leadRows.length - 1].walkInId = walkRows[walkRows.length - 1].id;
        }
        // Welcome message for recent enquiries
        if (createdAt.getTime() > pNow.getTime() - 3 * DAY) {
          const c = custRows[custIdx];
          const ch = c.consentWhatsapp ? "whatsapp" : c.consentSms ? "sms" : null;
          notifRows.push({
            event: "enquiry_received", dedupeKey: dedupeKey("enquiry_received", { leadId: id }), dealershipId: d.id, customerId: "", leadId: id, channel: ch, recipient: ch ? c.phone! : null,
            body: renderTemplate("enquiry_received", { customerName: c.name, dealershipName: d.name, models: chosen.map((m) => m.name).join(" / ") }),
            status: ch ? "sent" : "skipped", skipReason: ch ? null : "No recorded customer consent for any channel", provider: ch ? "console-simulated" : null, providerRef: ch ? `sim-crm-${notifRows.length}` : null,
            attempts: ch ? 1 : 0, lastAttemptAt: ch ? createdAt : null, sentAt: ch ? createdAt : null, isDemo: true, createdAt,
          });
        }
      }

      /* Service / parts / body-shop walk-ins (existing customers) */
      const other: [s.VisitType, number][] = [["service", p.serviceJobsPerDay * 0.25], ["spare_parts", p.code === "RR" ? 0.1 : 1.5], ["body_shop", p.bodyShop ? p.bodyJobsPerDay * 0.4 : 0]];
      for (const [type, lambda] of other) {
        for (let k = poisson(lambda); k > 0; k--) {
          const v = visit(type);
          if (!v || !svcPool.length) continue;
          const c = pick(svcPool);
          const veh = ctx.vehicles.find((x) => x.customerId === c.id);
          walkRows.push({
            id: crypto.randomUUID(), dealershipId: d.id, customerId: c.id, visitType: type, token: v.token, businessDate: day, capturedVia: chance(0.8) ? "kiosk" : "staff", kioskUserId: kiosk?.id ?? null,
            registrationNo: type === "spare_parts" ? null : veh?.registrationNo ?? null, vehicleModel: veh?.model ?? null,
            request: type === "service" ? pick(["Periodic service", "Repair / a problem", "Tyres / wheel alignment"]) : type === "spare_parts" ? pick(["Wiper blades", "Floor mats", "Brake pads", "Car cover"]) : pick(["Bumper scratch", "Door dent", "Windscreen crack"]),
            insuranceClaim: type === "body_shop" ? chance(0.6) : null, status: v.status, attendedById: v.attendedAt ? advisor?.id ?? null : null, attendedAt: v.attendedAt,
            closedAt: v.status === "done" || v.status === "left" ? new Date(v.at.getTime() + between(15, 60) * 60_000) : null,
            outcomeNote: v.status === "left" ? "Left before being attended" : null, isDemo: true, createdAt: v.at,
          });
        }
      }

      /* Lounge feedback (every lounge customer; tagged by car age) */
      for (let k = poisson(p.serviceJobsPerDay * 0.18); k > 0; k--) {
        const at = new Date(zonedMidnight(day).getTime() + between(10, 18) * HOUR);
        if (at > pNow || !svcPool.length) continue;
        const c = pick(svcPool);
        const veh = ctx.vehicles.find((x) => x.customerId === c.id);
        const year = veh?.year ?? 2020;
        const old = Number(today.slice(0, 4)) - year >= 5;
        const r = rnd();
        const interest = old ? (r < 0.35 ? "yes" : r < 0.75 ? "maybe" : "no") : r < 0.1 ? "yes" : r < 0.4 ? "maybe" : "no";
        const upgradeBrand = ["Honda", "Hyundai", "Volkswagen"].includes(p.brand) && chance(0.2) ? ctx.brands.find((b) => b.name === "BMW") : null;
        const prefModels = interest === "no" ? [] : [...new Set([pick(modelsOf(upgradeBrand?.id ?? d.brandId)), ...(chance(0.3) ? [pick(dModels)] : [])])];
        const marketing = interest !== "no" && chance(0.75);
        if (marketing) marketingYes.add(c.id);
        const ageDays = (pNow.getTime() - at.getTime()) / DAY;
        loungeRows.push({
          dealershipId: d.id, customerId: c.id, kioskUserId: kiosk?.id ?? null, currentMake: p.brand, currentModel: veh?.model ?? null, registrationNo: veh?.registrationNo ?? null,
          purchaseYear: year, serviceRating: 3 + Math.floor(rnd() * 3), interest,
          timeframe: interest === "yes" ? pick(["within_1m", "1_3m", "3_6m"] as const) : interest === "maybe" ? pick(["6_12m", "12m_plus"] as const) : "not_planning",
          budgetBand: interest === "no" ? null : pick(BUDGET_BY_BRAND[upgradeBrand?.name ?? p.brand] ?? ["10_15l"]),
          preferredBodyType: interest === "no" ? null : prefModels[0]?.bodyType ?? null, preferredFuel: interest === "no" ? null : chance(0.3) ? "ev" : null,
          preferredModelIds: prefModels.map((m) => m.id), otherPreferences: interest !== "no" && chance(0.25) ? pick(["Needs 7 seats", "Sunroof", "Automatic gearbox", "Lower running cost"]) : null,
          status: ageDays > 14 && interest !== "no" ? (chance(0.3) ? "contacted" : chance(0.1) ? "not_now" : "new") : "new", isDemo: true, createdAt: at,
        });
      }
    }
  }

  /* Insert customers, then wire ids */
  const newCustomers: (typeof s.customers.$inferSelect)[] = [];
  for (let i = 0; i < custRows.length; i += 1000) newCustomers.push(...(await db.insert(s.customers).values(custRows.slice(i, i + 1000)).returning()));
  const custOfLead = (leadId: string) => newCustomers[leadCustIdx.get(leadId)!];
  for (const l of leadRows) l.customerId = custOfLead(l.id).id;
  for (const w of walkRows) if (w.leadId) w.customerId = custOfLead(w.leadId).id;
  for (const n of notifRows) n.customerId = custOfLead(n.leadId!).id;
  if (marketingYes.size) {
    const ids = [...marketingYes];
    for (let i = 0; i < ids.length; i += 500) await db.update(s.customers).set({ consentMarketing: true }).where(inArray(s.customers.id, ids.slice(i, i + 500)));
  }

  // Tokens follow arrival order per dealership, day and visit type.
  const groups = new Map<string, typeof walkRows>();
  for (const w of walkRows) {
    const k = `${w.dealershipId}|${w.businessDate}|${w.visitType}`;
    groups.set(k, [...(groups.get(k) ?? []), w]);
  }
  for (const g of groups.values()) g.sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime()).forEach((w, i) => (w.token = formatToken(w.visitType, i + 1)));

  const chunk = async (table: Parameters<DB["insert"]>[0], rows: unknown[], size = 1000) => {
    for (let i = 0; i < rows.length; i += size) await db.insert(table).values(rows.slice(i, i + size) as never);
  };
  await chunk(s.leads, leadRows, 500);
  await chunk(s.walkIns, walkRows, 1000);
  await chunk(s.leadInterests, interestRows, 2000);
  await chunk(s.testDrives, driveRows, 1000);
  await chunk(s.leadActivities, actRows, 2000);
  await chunk(s.followUps, fuRows, 1000);
  await chunk(s.loungeFeedback, loungeRows, 1000);

  /* Two published model updates (neutral demo text) with messages + call tasks */
  const updates: { code: string; model: string; daysAgo: number; type: (typeof s.MODEL_UPDATE_TYPES)[number]; title: string; message: string }[] = [
    { code: "HYU", model: "Creta", daysAgo: 4, type: "stock_arrival", title: "Demo: new colours in the showroom", message: "Demo message — new colour options are now on display. Visit or reply to book a viewing." },
    { code: "HON", model: "Elevate", daysAgo: 10, type: "event", title: "Demo: weekend test-drive event", message: "Demo message — test drives available all weekend at the showroom. Reply to reserve a slot." },
  ];
  let messages = notifRows.length;
  for (const u of updates) {
    const d = dealerBy(u.code);
    const m = modelsOf(d.brandId).find((x) => x.name === u.model);
    if (!m) continue;
    const at = new Date(now.getTime() - u.daysAgo * DAY);
    const audience = leadRows.filter((l) => l.dealershipId === d.id && l.createdAt! < at && (!l.closedAt || l.closedAt > at) && leadModels.get(l.id)?.includes(m.id) && hasMarketingPermission(custOfLead(l.id)));
    const [upd] = await db.insert(s.modelUpdates).values({
      modelId: m.id, dealershipId: d.id, type: u.type, title: u.title, message: u.message, status: "published", publishedAt: at, recipients: audience.length, tasksCreated: audience.length, isDemo: true, createdAt: at,
      createdById: usersAt(d.id, "dealership_manager")[0]?.id ?? null,
    }).returning();
    const nRows: (typeof s.notifications.$inferInsert)[] = [];
    const fRows: (typeof s.followUps.$inferInsert)[] = [];
    const aRows: (typeof s.leadActivities.$inferInsert)[] = [];
    for (const l of audience) {
      const c = custOfLead(l.id);
      const ch = c.consentWhatsapp ? "whatsapp" : "sms";
      nRows.push({
        event: "model_update", dedupeKey: dedupeKey("model_update", { leadId: l.id, variant: upd.id }), dealershipId: d.id, customerId: c.id, leadId: l.id, channel: ch, recipient: c.phone,
        body: renderTemplate("model_update", { customerName: c.name, dealershipName: d.name, models: m.name, updateTitle: u.title, updateMessage: u.message }),
        status: "sent", provider: "console-simulated", providerRef: `sim-crm-upd-${messages++}`, attempts: 1, lastAttemptAt: at, sentAt: at, isDemo: true, createdAt: at,
      });
      const due = defaultFollowUpAt("model_update", at);
      const done = due < now && chance(0.6);
      fRows.push({ leadId: l.id, assignedToId: l.consultantId, dueAt: due, kind: "call", reason: `Call about: ${u.title} (${m.name})`, modelUpdateId: upd.id, status: done ? "done" : "open", completedAt: done ? new Date(due.getTime() - 2 * HOUR) : null, completedById: done ? l.consultantId : null, outcomeNote: done ? pick(CALL_NOTES) : null, createdAt: at });
      aRows.push({ leadId: l.id, type: "nurture", text: `Update sent: ${u.title}`, userId: upd.createdById, at });
    }
    await chunk(s.notifications, nRows);
    await chunk(s.followUps, fRows);
    await chunk(s.leadActivities, aRows);
  }
  await chunk(s.notifications, notifRows);

  return { carModels: models.length, walkIns: walkRows.length, leads: leadRows.length, testDrives: driveRows.length, loungeFeedback: loungeRows.length };
}
