"use server";
import { getDb } from "@/db/client";
import { actorForAction } from "@/server/auth";
import { run, type ActionResult } from "@/server/action-result";
import { retryNotification } from "@/server/services/admin";

export async function retryNotificationAction(_p: ActionResult<unknown> | undefined, f: FormData) {
  const res = await run(async () => {
    const n = await retryNotification(await getDb(), await actorForAction("notifications.retry"), String(f.get("id")));
    return n.status;
  });
  if (res.ok) return { ...res, message: res.data === "sent" ? "Sent" : `Still ${res.data} — check the provider` };
  return res;
}
