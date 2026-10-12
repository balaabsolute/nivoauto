/**
 * Showroom & sales integration tests — real services on in-memory Postgres.
 * Kiosk capture → walk-in + enquiry, front desk → job card, nurture model updates (consent, outcomes),
 * follow-ups, test drives, outcomes, lounge feedback → prospects → conversion, and role boundaries.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { useInMemoryDbForTests, type DB } from "@/db/client";
import * as s from "@/db/schema";
import { ensureDefaultStages } from "@/db/seed-demo";
import { loadActor, type Actor } from "@/server/principal";
import { setProviderForTests, type NotificationProvider } from "@/server/notify/providers";
import {
  captureVisit, submitLoungeFeedback, listFrontDesk, attendWalkIn, openJobFromWalkIn, closeWalkIn, listLeads, getLead, assignLead, updateLead,
  requestTestDrive, completeTestDrive, addFollowUp, completeFollowUp, closeLead, reopenLead, publishModelUpdate, nurtureAudience, listProspects,
  convertProspect, createLead, myFollowUps,
} from "@/server/services/crm";
import { buildDashboard } from "@/server/analytics";
import { resolvePeriod, businessDate } from "@/domain/periods";
import { ForbiddenError } from "@/domain/permissions";
import { ConflictError, ValidationError } from "@/server/errors";

let db: DB;
const ids: Record<string, string> = {};
const A: Record<string, Actor> = {};
const sent: { channel: string; body: string; recipient: string }[] = [];
const provider: NotificationProvider = {
  name: "test",
  channels: ["whatsapp", "sms", "email"],
  async send(m) {
    sent.push({ channel: m.channel, body: m.body, recipient: m.recipient });
    return { ok: true };
  },
};
let phoneSeq = 9_100_000_000;
const phone = () => String(++phoneSeq);

beforeAll(async () => {
  db = await useInMemoryDbForTests();
  await ensureDefaultStages(db);
  setProviderForTests(provider);
  const [le] = await db.insert(s.legalEntities).values({ code: "LE1", name: "Entity 1" }).returning();
  const [le2] = await db.insert(s.legalEntities).values({ code: "LE2", name: "Entity 2" }).returning();
  const [bA] = await db.insert(s.brands).values({ name: "BrandA" }).returning();
  const [bB] = await db.insert(s.brands).values({ name: "BrandB" }).returning();
  const [dA] = await db.insert(s.dealerships).values({ code: "SA", name: "Showroom A", brandId: bA.id, legalEntityId: le.id, locationName: "L", hasBodyShop: true }).returning();
  const [dB] = await db.insert(s.dealerships).values({ code: "SB", name: "Showroom B", brandId: bB.id, legalEntityId: le2.id, locationName: "L" }).returning();
  ids.dA = dA.id;
  ids.dB = dB.id;
  const ms = await db.insert(s.carModels).values([
    { brandId: bA.id, name: "Alpha", bodyType: "suv" },
    { brandId: bA.id, name: "Beta", bodyType: "sedan" },
    { brandId: bB.id, name: "Gamma", bodyType: "suv" },
  ]).returning();
  ids.alpha = ms[0].id;
  ids.beta = ms[1].id;
  ids.gamma = ms[2].id;
  const mk = async (key: string, role: s.Role, dealers: string[]) => {
    const [u] = await db.insert(s.users).values({ email: `${key}@t.local`, name: key, role, passwordHash: "x" }).returning();
    if (dealers.length) await db.insert(s.userDealerships).values(dealers.map((d) => ({ userId: u.id, dealershipId: d })));
    ids[key] = u.id;
    A[key] = (await loadActor(db, u.id))!;
  };
  await mk("kioskA", "kiosk", [dA.id]);
  await mk("kioskB", "kiosk", [dB.id]);
  await mk("scA", "sales_consultant", [dA.id]);
  await mk("scA2", "sales_consultant", [dA.id]);
  await mk("scB", "sales_consultant", [dB.id]);
  await mk("mgrA", "dealership_manager", [dA.id]);
  await mk("mgrB", "dealership_manager", [dB.id]);
  await mk("advA", "service_advisor", [dA.id]);
  await mk("md", "md", []);
});
beforeEach(() => {
  sent.length = 0;
});

const enquiry = (o: Record<string, unknown> = {}) =>
  captureVisit(db, A.kioskA, { visitType: "new_car", name: "Walk In", phone: phone(), consentWhatsapp: true, consentMarketing: true, modelIds: [ids.alpha], testDrive: true, timeframe: "1_3m", budgetBand: "15_25l", ...o });

describe("kiosk capture", () => {
  it("new-car walk-in creates a token, a walk-in, an open enquiry with interests and a test-drive request, and thanks the customer", async () => {
    const r = await enquiry({ modelIds: [ids.alpha, ids.beta] });
    expect(r.token).toMatch(/^N-\d{3}$/);
    expect(Object.keys(r).sort()).toEqual(["label", "leadId", "token", "visitType", "walkInId"]); // nothing about the customer
    const d = await getLead(db, A.mgrA, r.leadId!);
    expect(d.lead.status).toBe("open");
    expect(d.lead.source).toBe("walk_in");
    expect(d.interests.map((i) => i.m.name).sort()).toEqual(["Alpha", "Beta"]);
    expect(d.drives[0].t.status).toBe("requested");
    expect(d.lead.budgetMin).toBe(1_500_000);
    expect(sent.some((m) => m.body.includes("Alpha, Beta"))).toBe(true);
  });

  it("a repeat visit reuses the open enquiry instead of duplicating it", async () => {
    const p = phone();
    const r1 = await enquiry({ phone: p });
    const r2 = await enquiry({ phone: p, modelIds: [ids.beta], testDrive: false });
    expect(r2.leadId).toBe(r1.leadId);
    const d = await getLead(db, A.mgrA, r1.leadId!);
    expect(d.interests.length).toBe(2);
    expect(d.activities.some((a) => a.a.text?.includes("Visited the showroom again"))).toBe(true);
  });

  it("validates per visit type and the showroom's range", async () => {
    await expect(enquiry({ modelIds: [] })).rejects.toThrow(/at least one car/);
    await expect(enquiry({ modelIds: [ids.gamma] })).rejects.toThrow(/this showroom/);
    await expect(enquiry({ phone: "12345" })).rejects.toThrow(/10-digit/);
    await expect(captureVisit(db, A.kioskA, { visitType: "service", name: "Svc", phone: phone() })).rejects.toThrow(/registration/);
    await expect(captureVisit(db, A.kioskB, { visitType: "body_shop", name: "Body", phone: phone(), registrationNo: "TN01AB1234" })).rejects.toThrow(/body shop/);
  });

  it("kiosk devices can only submit — no reading", async () => {
    await expect(listLeads(db, A.kioskA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listFrontDesk(db, A.kioskA, businessDate())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listProspects(db, A.kioskA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("tokens count per type per day", async () => {
    const a = await captureVisit(db, A.kioskA, { visitType: "spare_parts", name: "Parts", phone: phone(), request: "Wiper blades" });
    const b = await captureVisit(db, A.kioskA, { visitType: "spare_parts", name: "Parts 2", phone: phone(), request: "Air filter" });
    expect(Number(b.token.slice(2))).toBe(Number(a.token.slice(2)) + 1);
    expect(a.token.startsWith("P-")).toBe(true);
  });
});

describe("front desk", () => {
  it("advisor sees service-side visits only; consultant attending a new-car visit picks up the enquiry", async () => {
    const r = await enquiry();
    const svc = await captureVisit(db, A.kioskA, { visitType: "service", name: "Svc Cust", phone: phone(), registrationNo: "tn 09 xy 4321", vehicleModel: "Alpha", request: "Periodic service", consentSms: true });
    const advView = await listFrontDesk(db, A.advA, businessDate());
    expect(advView.some((v) => v.w.visitType === "new_car")).toBe(false);
    expect(advView.some((v) => v.w.id === svc.walkInId)).toBe(true);
    await attendWalkIn(db, A.scA, r.walkInId);
    const d = await getLead(db, A.scA, r.leadId!);
    expect(d.lead.consultantId).toBe(ids.scA);
    await expect(attendWalkIn(db, A.scA2, r.walkInId)).rejects.toThrow(/already/);
    // service visit → job card, capture once
    const job = await openJobFromWalkIn(db, A.advA, svc.walkInId);
    expect(job.jobNo).toMatch(/^SVC-SA-/);
    expect(job.complaint).toBe("Periodic service");
    await expect(openJobFromWalkIn(db, A.advA, svc.walkInId)).rejects.toBeInstanceOf(ConflictError);
    await closeWalkIn(db, A.scA, r.walkInId, "done", "Shared brochure");
  });
});

describe("enquiry workflow", () => {
  it("assignment rules: consultant self-picks unassigned; reassigning needs a manager; assignee must be at the dealership", async () => {
    const r = await enquiry();
    await assignLead(db, A.scA, r.leadId!, ids.scA);
    await expect(assignLead(db, A.scA, r.leadId!, ids.scA2)).rejects.toBeInstanceOf(ForbiddenError);
    await assignLead(db, A.mgrA, r.leadId!, ids.scA2);
    await expect(assignLead(db, A.mgrA, r.leadId!, ids.scB)).rejects.toThrow(/at this dealership/);
    await expect(getLead(db, A.scB, r.leadId!)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("test drive completion needs a licence check and moves the stage", async () => {
    const r = await enquiry({ testDrive: false });
    const td = await requestTestDrive(db, A.scA, r.leadId!, ids.alpha, null);
    await expect(completeTestDrive(db, A.scA, td.id, { licenceChecked: false })).rejects.toThrow(/licence/);
    await completeTestDrive(db, A.scA, td.id, { licenceChecked: true, rating: 4, notes: "Liked the ride" });
    const d = await getLead(db, A.scA, r.leadId!);
    expect(d.lead.stage).toBe("test_drive");
    expect(d.lead.nextFollowUpAt).not.toBeNull();
    await expect(requestTestDrive(db, A.scA, r.leadId!, ids.gamma, null)).rejects.toThrow(/range/);
  });

  it("follow-ups: add, complete with a note, next due recalculated", async () => {
    const r = await enquiry();
    await assignLead(db, A.scA, r.leadId!, ids.scA);
    const f = await addFollowUp(db, A.scA, r.leadId!, { dueAt: new Date(Date.now() - 3_600_000), kind: "call", reason: "Share on-road price" });
    expect((await myFollowUps(db, A.scA)).some((x) => x.f.id === f.id)).toBe(true);
    expect((await myFollowUps(db, A.scA2)).some((x) => x.f.id === f.id)).toBe(false);
    await expect(completeFollowUp(db, A.scA, f.id, { status: "done", outcomeNote: "" })).rejects.toThrow(/Note/);
    await completeFollowUp(db, A.scA, f.id, { status: "done", outcomeNote: "Sent quote on WhatsApp" });
    const d = await getLead(db, A.scA, r.leadId!);
    expect(d.lead.lastContactAt).not.toBeNull();
  });

  it("closing outcomes stop nurture; opt-out sets the customer's marketing opt-out; reopen rules", async () => {
    const won = await enquiry();
    await closeLead(db, A.scA, won.leadId!, { status: "won", wonInvoiceRef: "INV-9" });
    const lost = await enquiry();
    await expect(closeLead(db, A.scA, lost.leadId!, { status: "lost_other_dealer" })).rejects.toThrow(/brand/);
    await closeLead(db, A.scA, lost.leadId!, { status: "lost_other_dealer", lostToBrand: "OtherBrand", lostToModel: "Zeta", lostToDealer: "Rival Motors" });
    const no = await enquiry();
    await closeLead(db, A.scA, no.leadId!, { status: "not_interested", reason: "Postponed purchase" });
    const opt = await enquiry();
    await closeLead(db, A.scA, opt.leadId!, { status: "opted_out" });
    const d = await getLead(db, A.mgrA, opt.leadId!);
    expect(d.customer.consent.optedOutAt).not.toBeNull();
    expect(d.customer.nurture).toBe("closed");
    await expect(updateLead(db, A.scA, won.leadId!, { stage: "negotiation" })).rejects.toThrow(/Closed/);
    await expect(reopenLead(db, A.scA, no.leadId!, "Came back")).rejects.toBeInstanceOf(ForbiddenError);
    await reopenLead(db, A.mgrA, no.leadId!, "Customer called back");
    await expect(reopenLead(db, A.mgrA, opt.leadId!, "x")).rejects.toThrow(/opted out/);
    // open follow-ups were cancelled on close
    const fus = await db.select().from(s.followUps).where(and(eq(s.followUps.leadId, lost.leadId!), eq(s.followUps.status, "open")));
    expect(fus).toHaveLength(0);
  });
});

describe("nurture: model updates", () => {
  it("reaches only open enquiries for the model with marketing consent; creates call tasks; respects outcomes and opt-outs", async () => {
    const eligible = await enquiry({ modelIds: [ids.beta] });
    const noMkt = await enquiry({ modelIds: [ids.beta], consentMarketing: false });
    const noChannel = await enquiry({ modelIds: [ids.beta], consentWhatsapp: false });
    const closed = await enquiry({ modelIds: [ids.beta] });
    await closeLead(db, A.mgrA, closed.leadId!, { status: "won" });
    const otherModel = await enquiry({ modelIds: [ids.alpha] });
    await assignLead(db, A.mgrA, eligible.leadId!, ids.scA);

    const aud = await nurtureAudience(db, A.mgrA, { modelId: ids.beta });
    const leadIds = aud.eligible.map((e) => e.leadId);
    expect(leadIds).toContain(eligible.leadId);
    expect(leadIds).not.toContain(noMkt.leadId);
    expect(leadIds).not.toContain(noChannel.leadId);
    expect(leadIds).not.toContain(closed.leadId);
    expect(leadIds).not.toContain(otherModel.leadId);
    expect(aud.skipped.no_marketing_consent).toBeGreaterThanOrEqual(1);
    expect(aud.skipped.no_channel).toBeGreaterThanOrEqual(1);

    sent.length = 0;
    const res = await publishModelUpdate(db, A.mgrA, { modelId: ids.beta, type: "offer", title: "Festive offer", message: "Benefits of up to ₹40,000 this month." });
    expect(res.sent).toBe(aud.eligible.length);
    expect(sent.filter((m) => m.body.includes("Festive offer")).length).toBe(aud.eligible.length);
    const tasks = await db.select().from(s.followUps).where(eq(s.followUps.modelUpdateId, res.update.id));
    expect(tasks).toHaveLength(aud.eligible.length);
    expect(tasks.find((t) => t.leadId === eligible.leadId)!.assignedToId).toBe(ids.scA);
    // publishing again with a new update sends again (different milestone); same update never sends twice
    const n = await db.select().from(s.notifications).where(and(eq(s.notifications.leadId, eligible.leadId!), eq(s.notifications.event, "model_update")));
    expect(n).toHaveLength(1);
  });

  it("consultants can't publish; managers can't publish outside their scope", async () => {
    await expect(publishModelUpdate(db, A.scA, { modelId: ids.beta, type: "offer", title: "X offer", message: "Something new here" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishModelUpdate(db, A.mgrA, { modelId: ids.gamma, type: "offer", title: "X offer", message: "Something new here" })).rejects.toThrow(/No dealership in your scope/);
  });
});

describe("lounge feedback → future prospects", () => {
  it("lounge feedback without marketing consent leaves existing service-update consent untouched", async () => {
    const p = phone();
    await captureVisit(db, A.kioskA, { visitType: "spare_parts", name: "Existing", phone: p, consentWhatsapp: true, request: "Mats" });
    await submitLoungeFeedback(db, A.kioskA, { name: "Existing", phone: p, consentMarketing: false, interest: "maybe", purchaseYear: 2019 });
    const [c] = await db.select().from(s.customers).where(eq(s.customers.phone, `+91${p}`));
    expect(c.consentWhatsapp).toBe(true);
    expect(c.consentMarketing).toBe(false);
  });

  it("any lounge customer can respond; 5+ year cars are tagged; prospects can be nurtured and converted cross-brand", async () => {
    const thisYear = Number(businessDate().slice(0, 4));
    const pPhone = phone();
    const r = await submitLoungeFeedback(db, A.kioskA, {
      name: "Lounge Old Car", phone: pPhone, consentWhatsapp: true, consentMarketing: true, currentMake: "BrandA", currentModel: "Alpha",
      purchaseYear: thisYear - 7, serviceRating: 5, interest: "yes", timeframe: "3_6m", budgetBand: "25_50l", preferredModelIds: [ids.gamma, ids.beta],
    });
    expect(r.upgradeCandidate).toBe(true);
    const r2 = await submitLoungeFeedback(db, A.kioskA, { name: "Lounge New Car", phone: phone(), purchaseYear: thisYear - 1, interest: "no" });
    expect(r2.upgradeCandidate).toBe(false);
    await expect(submitLoungeFeedback(db, A.kioskA, { name: "X Y", phone: phone(), purchaseYear: thisYear + 1, interest: "maybe" })).rejects.toThrow(/future/);

    const list = await listProspects(db, A.mgrA, { upgradeOnly: true });
    const mine = list.find((p) => p.f.currentModel === "Alpha" && p.upgradeCandidate);
    expect(mine).toBeTruthy();
    expect(mine!.preferredModels.map((m) => m.name).sort()).toEqual(["Beta", "Gamma"]);
    // "no" responses are parked as not_now and not in the default list
    expect(list.some((p) => p.f.interest === "no")).toBe(false);

    // Model update including prospects reaches this customer for Beta (same brand)
    sent.length = 0;
    const res = await publishModelUpdate(db, A.mgrA, { modelId: ids.beta, type: "new_variant", title: "New Beta variant", message: "A new hybrid variant has arrived.", includeProspects: true });
    expect(res.prospects).toBeGreaterThanOrEqual(1);

    // Convert to an enquiry at Showroom B (different brand and legal entity).
    await expect(convertProspect(db, A.mgrA, mine!.f.id, ids.dB)).rejects.toBeInstanceOf(ForbiddenError);
    // Manager B can't see dealership A's lounge, but may convert into their own showroom (target scope).
    const leadId = await convertProspect(db, A.mgrB, mine!.f.id, ids.dB);
    const d = await getLead(db, A.mgrB, leadId);
    expect(d.lead.source).toBe("lounge_feedback");
    expect(d.interests.map((i) => i.m.name)).toEqual(["Gamma"]);
    expect(d.lead.exchangeVehicle).toContain("Alpha");
    await expect(convertProspect(db, A.mgrB, mine!.f.id, ids.dB)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("staff-recorded enquiries and the dashboard funnel", () => {
  it("phone enquiries are recorded; duplicates prevented; funnel counts recorded activity", async () => {
    const p = phone();
    await createLead(db, A.scA, { dealershipId: ids.dA, name: "Phone Lead", phone: p, consentWhatsapp: true, consentMarketing: true, modelIds: [ids.alpha], source: "phone" });
    await expect(createLead(db, A.scA, { dealershipId: ids.dA, name: "Phone Lead", phone: p, modelIds: [ids.beta], source: "phone" })).rejects.toBeInstanceOf(ConflictError);
    const today = businessDate();
    const dash = await buildDashboard(db, A.mgrA, resolvePeriod("today", today), { syncAlerts: false });
    const f = dash.dealers[0].showroom;
    expect(f.walkIns.new_car).toBeGreaterThan(0);
    expect(f.enquiries).toBeGreaterThan(0);
    expect(f.won).toBeGreaterThanOrEqual(1);
    expect(f.lostOtherDealer).toBeGreaterThanOrEqual(1);
    expect(f.testDrives).toBeGreaterThanOrEqual(1);
  });

  it("validation errors are friendly", async () => {
    await expect(createLead(db, A.scA, { dealershipId: ids.dA, name: "X", phone: phone(), modelIds: [ids.alpha] })).rejects.toBeInstanceOf(ValidationError);
  });
});
