"use server";
import { getDb } from "@/db/client";
import { actorForAction } from "@/server/auth";
import { run, type ActionResult } from "@/server/action-result";
import {
  createJob, transitionJob, updateJob, recordApproval, cancelJob, addNote, setChecklistItem, addPart, setPartStatus, logLabour, addPhoto,
} from "@/server/services/jobs";
import { zonedMidnight } from "@/domain/periods";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v == null ? null : Number(v.replace(/,/g, ""));
};
/** datetime-local (IST wall clock) → Date */
function localDateTime(v: string | null): Date | null {
  if (!v) return null;
  const [d, t] = v.split("T");
  if (!d || !t) return null;
  const [h, m] = t.split(":").map(Number);
  return new Date(zonedMidnight(d).getTime() + (h * 60 + m) * 60_000);
}

type R = ActionResult<unknown> | undefined;

export async function createJobAction(_p: R, f: FormData): Promise<ActionResult<unknown>> {
  let id: string | undefined;
  const res = await run(async () => {
    const actor = await actorForAction("jobs.create");
    const job = await createJob(await getDb(), actor, {
      dealershipId: str(f, "dealershipId") ?? "",
      jobType: (str(f, "jobType") ?? "service") as "service",
      source: "walk_in",
      customerName: str(f, "customerName") ?? "",
      phone: str(f, "phone"),
      email: str(f, "email"),
      preferredChannel: (str(f, "preferredChannel") as "whatsapp") ?? null,
      consentWhatsapp: f.get("consentWhatsapp") === "on",
      consentSms: f.get("consentSms") === "on",
      consentEmail: f.get("consentEmail") === "on",
      registrationNo: str(f, "registrationNo") ?? "",
      make: str(f, "make"),
      model: str(f, "model"),
      complaint: str(f, "complaint") ?? "",
      odometerKm: num(f, "odometerKm"),
      promisedAt: localDateTime(str(f, "promisedAt")),
      estimateAmount: num(f, "estimateAmount"),
      insurerName: str(f, "insurerName"),
      claimRef: str(f, "claimRef"),
    });
    id = job.id;
  });
  if (res.ok && id) return { ok: true as const, data: { redirectTo: `/jobs/${id}?created=1` } };
  return res;
}

export async function transitionAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const res = await run(async () => {
    await transitionJob(await getDb(), await actorForAction(), id, str(f, "toStage") ?? "", { reason: str(f, "reason") ?? undefined, expectedVersion: num(f, "version") ?? undefined });
  }, "Stage updated");
  return res;
}

export async function updateJobAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const res = await run(async () => {
    const patch: Record<string, unknown> = {};
    const fields = f.getAll("_fields").map(String);
    for (const k of fields) {
      if (["promisedAt", "expectedCompletionAt"].includes(k)) patch[k] = localDateTime(str(f, k));
      else if (["estimatedHours", "estimateAmount", "odometerKm"].includes(k)) patch[k] = num(f, k);
      else if (k === "isComeback") patch[k] = f.get(k) === "on";
      else if (k === "blocker" || k === "paymentStatus") patch[k] = str(f, k) ?? (k === "blocker" ? "none" : "unbilled");
      else patch[k] = str(f, k);
    }
    await updateJob(await getDb(), await actorForAction(), id, patch, num(f, "version") ?? undefined);
  }, "Saved");
  return res;
}

export async function approvalAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const decision = str(f, "decision") as "approved" | "declined";
  const res = await run(async () => {
    await recordApproval(await getDb(), await actorForAction("jobs.manage"), id, decision, num(f, "approvedAmount"), str(f, "note") ?? undefined);
  }, decision === "approved" ? "Approval recorded" : "Decline recorded");
  return res;
}

export async function cancelAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const res = await run(async () => cancelJob(await getDb(), await actorForAction("jobs.manage"), id, str(f, "reason") ?? ""), "Job cancelled");
  return res;
}

export async function noteAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const res = await run(async () => addNote(await getDb(), await actorForAction(), id, str(f, "text") ?? ""), "Note added");
  return res;
}

export async function checklistAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const res = await run(async () => setChecklistItem(await getDb(), await actorForAction(), str(f, "itemId")!, str(f, "result") as "ok", str(f, "note")));
  return res;
}

export async function addPartAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const res = await run(async () => addPart(await getDb(), await actorForAction(), id, { description: str(f, "description") ?? "", partNo: str(f, "partNo"), quantity: num(f, "quantity") ?? 1 }), "Part requested");
  return res;
}

export async function partStatusAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const res = await run(async () => setPartStatus(await getDb(), await actorForAction(), str(f, "partId")!, str(f, "status") as "issued"));
  return res;
}

export async function labourAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const res = await run(async () => logLabour(await getDb(), await actorForAction(), id, { hours: num(f, "hours") ?? 0, workDate: str(f, "workDate") ?? undefined }), "Hours logged");
  return res;
}

export async function photoAction(_p: R, f: FormData) {
  const id = str(f, "jobId")!;
  const file = f.get("photo");
  const res = await run(async () => {
    if (!(file instanceof File) || file.size === 0) throw new (await import("@/server/errors")).ValidationError(["Choose a photo"]);
    await addPhoto(await getDb(), await actorForAction(), id, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, str(f, "caption") ?? undefined);
  }, "Photo added");
  return res;
}

export async function retryJobNotificationAction(_p: R, f: FormData) {
  const { retryNotification } = await import("@/server/services/admin");
  return run(async () => {
    const n = await retryNotification(await getDb(), await actorForAction("notifications.retry"), String(f.get("id")));
    return n.status;
  }, "Retried");
}
