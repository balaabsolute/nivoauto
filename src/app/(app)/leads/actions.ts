"use server";
import { getDb } from "@/db/client";
import { actorForAction } from "@/server/auth";
import { run, type ActionResult } from "@/server/action-result";
import {
  captureVisit, attendWalkIn, closeWalkIn, openJobFromWalkIn, createLead, updateLead, assignLead, setLeadInterests, logContact, requestTestDrive,
  completeTestDrive, cancelTestDrive, addFollowUp, completeFollowUp, closeLead, reopenLead, nurtureAudience, publishModelUpdate, setProspectStatus,
  convertProspect, saveCarModel,
} from "@/server/services/crm";
import { zonedMidnight } from "@/domain/periods";

type R = ActionResult<unknown> | undefined;
const v = (f: FormData, k: string) => {
  const x = f.get(k);
  return typeof x === "string" && x.trim() !== "" ? x.trim() : null;
};
const n = (f: FormData, k: string) => (v(f, k) == null ? null : Number(v(f, k)!.replace(/,/g, "")));
const on = (f: FormData, k: string) => f.get(k) === "on";
function localDateTime(x: string | null): Date | null {
  if (!x) return null;
  const [d, t] = x.split("T");
  if (!d) return null;
  const [h, m] = (t ?? "10:00").split(":").map(Number);
  return new Date(zonedMidnight(d).getTime() + (h * 60 + m) * 60_000);
}

/* Front desk */
export async function staffWalkInAction(_p: R, f: FormData) {
  return run(async () => {
    const r = await captureVisit(await getDb(), await actorForAction("frontdesk.view"), {
      dealershipId: v(f, "dealershipId") ?? "",
      visitType: (v(f, "visitType") ?? "new_car") as "new_car",
      name: v(f, "name") ?? "", phone: v(f, "phone") ?? "", email: v(f, "email"),
      consentWhatsapp: on(f, "consentUpdates"), consentSms: on(f, "consentUpdates"), consentMarketing: on(f, "consentMarketing"),
      modelIds: f.getAll("modelIds").map(String), testDrive: on(f, "testDrive"), timeframe: v(f, "timeframe") as never,
      registrationNo: v(f, "registrationNo"), vehicleModel: v(f, "vehicleModel"), request: v(f, "request"),
    });
    return { redirectTo: r.leadId ? `/leads/${r.leadId}` : undefined, token: r.token };
  }, "Walk-in recorded");
}
export async function attendAction(_p: R, f: FormData) {
  return run(async () => attendWalkIn(await getDb(), await actorForAction("frontdesk.view"), v(f, "id")!), "Marked as attending");
}
export async function closeVisitAction(_p: R, f: FormData) {
  return run(async () => closeWalkIn(await getDb(), await actorForAction("frontdesk.view"), v(f, "id")!, (v(f, "status") ?? "done") as "done", v(f, "note")), "Visit closed");
}
export async function openJobAction(_p: R, f: FormData): Promise<ActionResult<unknown>> {
  return run(async () => {
    const job = await openJobFromWalkIn(await getDb(), await actorForAction("jobs.create"), v(f, "id")!, { registrationNo: v(f, "registrationNo") });
    return { redirectTo: `/jobs/${job.id}?created=1` };
  });
}

/* Enquiries */
export async function createLeadAction(_p: R, f: FormData): Promise<ActionResult<unknown>> {
  return run(async () => {
    const l = await createLead(await getDb(), await actorForAction("leads.manage"), {
      dealershipId: v(f, "dealershipId") ?? "", source: (v(f, "source") ?? "phone") as "phone",
      name: v(f, "name") ?? "", phone: v(f, "phone") ?? "", email: v(f, "email"),
      consentWhatsapp: on(f, "consentUpdates"), consentSms: on(f, "consentUpdates"), consentMarketing: on(f, "consentMarketing"),
      modelIds: f.getAll("modelIds").map(String), timeframe: v(f, "timeframe") as never, budgetBand: v(f, "budgetBand") as never, notes: v(f, "notes"),
    });
    return { redirectTo: `/leads/${l.id}` };
  });
}
export async function updateLeadAction(_p: R, f: FormData) {
  return run(async () => updateLead(await getDb(), await actorForAction("leads.manage"), v(f, "leadId")!, {
    stage: (v(f, "stage") ?? undefined) as never, timeframe: v(f, "timeframe") as never, budgetMin: n(f, "budgetMin"), budgetMax: n(f, "budgetMax"),
    fuelPreference: v(f, "fuelPreference"), financeNeeded: f.get("financeNeeded") === "yes" ? true : f.get("financeNeeded") === "no" ? false : null,
    exchangeVehicle: v(f, "exchangeVehicle"), nextFollowUpAt: localDateTime(v(f, "nextFollowUpAt")),
  }), "Saved");
}
export async function assignLeadAction(_p: R, f: FormData) {
  return run(async () => assignLead(await getDb(), await actorForAction("leads.manage"), v(f, "leadId")!, v(f, "consultantId")), "Assigned");
}
export async function interestsAction(_p: R, f: FormData) {
  return run(async () => setLeadInterests(await getDb(), await actorForAction("leads.manage"), v(f, "leadId")!, f.getAll("modelIds").map(String)), "Models updated");
}
export async function logContactAction(_p: R, f: FormData) {
  return run(async () => logContact(await getDb(), await actorForAction("leads.manage"), v(f, "leadId")!, { type: (v(f, "type") ?? "call") as "call", text: v(f, "text") ?? "", nextFollowUpAt: f.has("nextFollowUpAt") ? localDateTime(v(f, "nextFollowUpAt")) : undefined }), "Logged");
}
export async function testDriveAction(_p: R, f: FormData) {
  return run(async () => requestTestDrive(await getDb(), await actorForAction("leads.manage"), v(f, "leadId")!, v(f, "modelId") ?? "", localDateTime(v(f, "scheduledAt"))), "Test drive added");
}
export async function completeTestDriveAction(_p: R, f: FormData) {
  return run(async () => completeTestDrive(await getDb(), await actorForAction("leads.manage"), v(f, "id")!, { licenceChecked: on(f, "licenceChecked"), rating: n(f, "rating"), notes: v(f, "notes") }), "Test drive completed");
}
export async function cancelTestDriveAction(_p: R, f: FormData) {
  return run(async () => cancelTestDrive(await getDb(), await actorForAction("leads.manage"), v(f, "id")!), "Cancelled");
}
export async function addFollowUpAction(_p: R, f: FormData) {
  return run(async () => addFollowUp(await getDb(), await actorForAction("leads.manage"), v(f, "leadId")!, { dueAt: localDateTime(v(f, "dueAt")) ?? new Date(NaN), kind: (v(f, "kind") ?? "call") as "call", reason: v(f, "reason") ?? "" }), "Follow-up added");
}
export async function completeFollowUpAction(_p: R, f: FormData) {
  return run(async () => completeFollowUp(await getDb(), await actorForAction("leads.manage"), v(f, "id")!, { status: (v(f, "status") ?? "done") as "done", outcomeNote: v(f, "note") ?? "" }), "Follow-up closed");
}
export async function closeLeadAction(_p: R, f: FormData) {
  return run(async () => closeLead(await getDb(), await actorForAction("leads.manage"), v(f, "leadId")!, {
    status: (v(f, "status") ?? "") as "won", reason: v(f, "reason"), lostToBrand: v(f, "lostToBrand"), lostToModel: v(f, "lostToModel"), lostToDealer: v(f, "lostToDealer"), wonInvoiceRef: v(f, "wonInvoiceRef"),
  }), "Outcome recorded. Nurture stopped for this enquiry.");
}
export async function reopenLeadAction(_p: R, f: FormData) {
  return run(async () => reopenLead(await getDb(), await actorForAction("leads.assign"), v(f, "leadId")!, v(f, "reason") ?? ""), "Reopened");
}

/* Nurture */
export async function previewUpdateAction(input: { modelId: string; dealershipId: string | null; includeProspects: boolean }) {
  return run(async () => {
    const a = await nurtureAudience(await getDb(), await actorForAction("model_updates.manage"), input);
    return { eligible: a.eligible.length, skipped: a.skipped, prospects: a.prospects.length, prospectsSkipped: a.prospectsSkipped };
  });
}
export async function publishUpdateAction(_p: R, f: FormData) {
  return run(async () => {
    const r = await publishModelUpdate(await getDb(), await actorForAction("model_updates.manage"), {
      modelId: v(f, "modelId") ?? "", dealershipId: v(f, "dealershipId"), type: (v(f, "type") ?? "offer") as "offer", title: v(f, "title") ?? "", message: v(f, "message") ?? "",
      validUntil: v(f, "validUntil"), includeProspects: on(f, "includeProspects"),
    });
    return r.sent + r.prospects;
  }).then((r) => (r.ok ? { ...r, message: `Published: ${r.data} customer${r.data === 1 ? "" : "s"} messaged and call tasks created for consultants.` } : r));
}

/* Prospects */
export async function prospectStatusAction(_p: R, f: FormData) {
  return run(async () => setProspectStatus(await getDb(), await actorForAction("leads.manage"), v(f, "id")!, (v(f, "status") ?? "contacted") as "contacted"), "Updated");
}
export async function convertProspectAction(_p: R, f: FormData): Promise<ActionResult<unknown>> {
  return run(async () => {
    const leadId = await convertProspect(await getDb(), await actorForAction("leads.manage"), v(f, "id")!, v(f, "dealershipId") ?? "");
    return { redirectTo: `/leads/${leadId}` };
  });
}

/* Catalogue */
export async function saveModelAction(_p: R, f: FormData) {
  return run(async () => saveCarModel(await getDb(), await actorForAction("catalogue.manage"), {
    id: v(f, "id") ?? undefined, brandId: v(f, "brandId") ?? "", name: v(f, "name") ?? "", bodyType: v(f, "bodyType"), fuelTypes: v(f, "fuelTypes"),
    priceBand: v(f, "priceBand"), active: on(f, "active"), sortOrder: n(f, "sortOrder") ?? 0,
  }), "Model saved");
}
