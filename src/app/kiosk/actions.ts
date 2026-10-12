"use server";
import { getDb } from "@/db/client";
import { actorForAction } from "@/server/auth";
import { run } from "@/server/action-result";
import { captureVisit, submitLoungeFeedback, type KioskVisitInput, type LoungeInput } from "@/server/services/crm";

/** Kiosk submissions return only a token / acknowledgement — never customer data. */
export async function submitKioskVisit(input: KioskVisitInput) {
  return run(async () => {
    const r = await captureVisit(await getDb(), await actorForAction("kiosk.submit"), input);
    return { token: r.token, label: r.label, visitType: r.visitType };
  });
}

export async function submitLounge(input: LoungeInput) {
  return run(async () => {
    await submitLoungeFeedback(await getDb(), await actorForAction("kiosk.submit"), input);
    return { ok: true };
  });
}
