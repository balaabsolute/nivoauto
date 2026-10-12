"use server";
import { getDb } from "@/db/client";
import { actorForAction } from "@/server/auth";
import { run, type ActionResult } from "@/server/action-result";
import { saveDailyReport } from "@/server/services/reporting";

export async function saveDailyReportAction(_p: ActionResult<unknown> | undefined, f: FormData) {
  const n = (k: string) => (String(f.get(k) ?? "").trim() === "" ? null : Number(f.get(k)));
  const submit = f.get("intent") === "submit";
  const res = await run(async () => {
    await saveDailyReport(await getDb(), await actorForAction("daily_report.submit"), {
      dealershipId: String(f.get("dealershipId")),
      businessDate: String(f.get("businessDate")),
      leads: n("leads"),
      bookings: n("bookings"),
      bookingCancellations: n("bookingCancellations"),
      expectedDeliveries7d: n("expectedDeliveries7d"),
      availableBayHoursOverride: n("availableBayHoursOverride"),
      notes: String(f.get("notes") ?? "").trim() || null,
      submit,
    });
  }, submit ? "Daily report submitted" : "Draft saved");
  return res;
}
