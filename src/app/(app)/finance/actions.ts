"use server";
import { getDb } from "@/db/client";
import { actorForAction } from "@/server/auth";
import { run, type ActionResult } from "@/server/action-result";
import { createManualTransaction, setReconciliation, importTransactionsCsv, upsertTarget, type ImportRowResult } from "@/server/services/finance";
import type { RevenueCategory, TxnKind, ReconStatus } from "@/db/schema";

type R = ActionResult<unknown> | undefined;
const v = (f: FormData, k: string) => (String(f.get(k) ?? "").trim() || null);
const n = (f: FormData, k: string) => (v(f, k) == null ? null : Number(v(f, k)!.replace(/,/g, "")));

export async function manualTxnAction(_p: R, f: FormData) {
  const res = await run(async () => {
    await createManualTransaction(await getDb(), await actorForAction("transactions.manage"), {
      dealershipId: v(f, "dealershipId") ?? "",
      businessDate: v(f, "businessDate") ?? "",
      category: v(f, "category") as RevenueCategory,
      kind: (v(f, "kind") ?? "invoice") as TxnKind,
      partsChannel: v(f, "partsChannel") as "retail" | null,
      revenueAmount: n(f, "revenueAmount") ?? NaN,
      taxAmount: n(f, "taxAmount"),
      directCostAmount: n(f, "directCostAmount"),
      units: n(f, "units"),
      invoiceRef: v(f, "invoiceRef"),
      notes: v(f, "notes"),
    });
  }, "Line recorded");
  return res;
}

export async function reconAction(_p: R, f: FormData) {
  const res = await run(async () => setReconciliation(await getDb(), await actorForAction("reconciliation.manage"), v(f, "id")!, v(f, "status") as ReconStatus));
  return res;
}

export type ImportState = ActionResult<{ fileName: string; csv: string; dryRun: boolean; rowsTotal: number; rowsAccepted: number; rowsRejected: number; rowsDuplicate: number; results: ImportRowResult[] }> | undefined;

export async function importAction(_p: ImportState, f: FormData): Promise<ImportState> {
  const dryRun = f.get("intent") !== "import";
  const file = f.get("file");
  let csv = String(f.get("csv") ?? "");
  let fileName = String(f.get("fileName") ?? "upload.csv");
  if (file instanceof File && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: "File is larger than 10 MB — split it into smaller files" };
    csv = await file.text();
    fileName = file.name;
  }
  if (!csv.trim()) return { ok: false, error: "Choose a CSV file" };
  const res = await run(async () => {
    const r = await importTransactionsCsv(await getDb(), await actorForAction("imports.run"), fileName, csv, { dryRun });
    return { fileName, csv, dryRun, rowsTotal: r.rowsTotal, rowsAccepted: r.rowsAccepted, rowsRejected: r.rowsRejected, rowsDuplicate: r.rowsDuplicate, results: r.results.filter((x) => x.status !== "accepted").slice(0, 200) };
  });
  return res;
}

export async function targetAction(_p: R, f: FormData) {
  const res = await run(async () => {
    await upsertTarget(await getDb(), await actorForAction("targets.manage"), {
      dealershipId: v(f, "dealershipId")!,
      month: v(f, "month")!,
      revenueTarget: n(f, "revenueTarget"),
      deliveriesTarget: n(f, "deliveriesTarget"),
      approve: f.get("intent") === "approve",
    });
  }, f.get("intent") === "approve" ? "Target saved and approved" : "Target saved as draft (not used until approved)");
  return res;
}
