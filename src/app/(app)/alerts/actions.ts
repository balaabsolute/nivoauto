"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { actorForAction } from "@/server/auth";
import { run, type ActionResult } from "@/server/action-result";
import { updateAlert } from "@/server/services/reporting";

export async function updateAlertAction(_p: ActionResult<unknown> | undefined, f: FormData) {
  const v = (k: string) => (String(f.get(k) ?? "").trim() || null);
  const res = await run(async () => {
    await updateAlert(await getDb(), await actorForAction("alerts.manage"), String(f.get("id")), {
      status: (v("status") ?? undefined) as "open" | undefined,
      ownerId: v("ownerId"),
      dueDate: v("dueDate"),
      resolutionNote: v("resolutionNote"),
    });
  }, "Action updated");
  revalidatePath("/alerts");
  revalidatePath("/group");
  return res;
}
