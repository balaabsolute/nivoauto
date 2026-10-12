"use server";
import { getDb } from "@/db/client";
import { actorForAction } from "@/server/auth";
import { run, type ActionResult } from "@/server/action-result";
import { createAppointment, checkInAppointment, setAppointmentStatus } from "@/server/services/appointments";
import { zonedMidnight } from "@/domain/periods";

type R = ActionResult<unknown> | undefined;
const s = (f: FormData, k: string) => (typeof f.get(k) === "string" && String(f.get(k)).trim() ? String(f.get(k)).trim() : null);

export async function createAppointmentAction(_p: R, f: FormData) {
  const res = await run(async () => {
    const date = s(f, "date");
    const time = s(f, "time");
    if (!date || !time) throw new (await import("@/server/errors")).ValidationError(["Choose a date and time"]);
    const [h, m] = time.split(":").map(Number);
    await createAppointment(await getDb(), await actorForAction("appointments.manage"), {
      dealershipId: s(f, "dealershipId") ?? "",
      jobType: (s(f, "jobType") ?? "service") as "service",
      scheduledAt: new Date(zonedMidnight(date).getTime() + (h * 60 + m) * 60_000),
      requestedWork: s(f, "requestedWork") ?? "",
      customerName: s(f, "customerName") ?? "",
      phone: s(f, "phone"),
      email: s(f, "email"),
      registrationNo: s(f, "registrationNo") ?? "",
      model: s(f, "model"),
      consentWhatsapp: f.get("consentWhatsapp") === "on",
      consentSms: f.get("consentSms") === "on",
      consentEmail: f.get("consentEmail") === "on",
      preferredChannel: (s(f, "preferredChannel") as "whatsapp") ?? null,
    });
  }, "Appointment booked; confirmation recorded");
  return res;
}

export async function checkInAction(_p: R, f: FormData): Promise<ActionResult<unknown>> {
  let jobId: string | undefined;
  const res = await run(async () => {
    const job = await checkInAppointment(await getDb(), await actorForAction("appointments.manage"), s(f, "id")!);
    jobId = job.id;
  });
  if (res.ok && jobId) return { ok: true as const, data: { redirectTo: `/jobs/${jobId}?created=1` } };
  return res;
}

export async function appointmentStatusAction(_p: R, f: FormData) {
  const res = await run(async () => setAppointmentStatus(await getDb(), await actorForAction("appointments.manage"), s(f, "id")!, s(f, "status") as "no_show"));
  return res;
}
