import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  transactions, importBatches, dealerships, targets, users, REVENUE_CATEGORIES, TXN_KINDS, type RevenueCategory, type TxnKind, type ReconStatus,
} from "@/db/schema";
import { assertCan, assertDealership, dealershipScope } from "@/domain/permissions";
import { validateTransaction, type TransactionInput } from "@/domain/revenue";
import { businessDate } from "@/domain/periods";
import type { Actor } from "../principal";
import { audit } from "../audit";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { demoFilter } from "../data-mode";
import { parseCsv } from "@/lib/csv";

/* ───────────────────────── Manual entry ───────────────────────── */

export interface ManualTxnInput extends TransactionInput {
  dealershipId: string;
  notes?: string | null;
  jobId?: string | null;
}

export async function createManualTransaction(db: DB, actor: Actor, input: ManualTxnInput) {
  assertCan(actor, "transactions.manage");
  assertDealership(actor, input.dealershipId);
  const { errors, normalised } = validateTransaction(input, businessDate());
  if (errors.length) throw new ValidationError(errors);
  const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, input.dealershipId));
  if (!dealer) throw new ValidationError(["Dealership not found"]);
  // Manual source_ref = invoice ref + category + channel, so the same invoice line cannot be keyed twice.
  const sourceRef = [dealer.code, normalised.invoiceRef?.trim().toUpperCase() ?? `NOREF-${crypto.randomUUID()}`, normalised.kind, normalised.category, normalised.partsChannel ?? ""].join("|");
  const inserted = await db
    .insert(transactions)
    .values({
      businessDate: normalised.businessDate,
      dealershipId: dealer.id,
      legalEntityId: dealer.legalEntityId,
      brandId: dealer.brandId,
      category: normalised.category,
      kind: normalised.kind,
      partsChannel: normalised.partsChannel ?? null,
      revenueAmount: normalised.revenueAmount,
      taxAmount: normalised.taxAmount ?? null,
      directCostAmount: normalised.directCostAmount ?? null,
      units: normalised.units ?? null,
      invoiceRef: normalised.invoiceRef ?? null,
      jobId: input.jobId ?? null,
      source: "manual",
      sourceRef,
      notes: input.notes ?? null,
      createdById: actor.id,
      isDemo: dealer.isDemo,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) throw new ConflictError(`A ${normalised.category.replace("_", " ")} line for ${normalised.invoiceRef} has already been entered`);
  await audit(db, { userId: actor.id, action: "transaction.create", entityType: "transaction", entityId: inserted[0].id, dealershipId: dealer.id, after: inserted[0] });
  return inserted[0];
}

export async function setReconciliation(db: DB, actor: Actor, txnId: string, status: ReconStatus) {
  assertCan(actor, "reconciliation.manage");
  const [t] = await db.select().from(transactions).where(eq(transactions.id, txnId));
  if (!t) throw new NotFoundError();
  await db.update(transactions).set({ reconciliationStatus: status }).where(eq(transactions.id, txnId));
  await audit(db, { userId: actor.id, action: "transaction.reconciliation", entityType: "transaction", entityId: txnId, dealershipId: t.dealershipId, before: { status: t.reconciliationStatus }, after: { status } });
}

export async function listTransactions(db: DB, actor: Actor, f: { from: string; to: string; dealershipId?: string; category?: RevenueCategory; recon?: ReconStatus }) {
  assertCan(actor, "financials.view");
  const conds: (SQL | undefined)[] = [gte(transactions.businessDate, f.from), lte(transactions.businessDate, f.to), demoFilter(transactions.isDemo)];
  const scope = dealershipScope(actor);
  if (scope !== "all") conds.push(scope.length ? inArray(transactions.dealershipId, scope) : sql`false`);
  if (f.dealershipId) conds.push(eq(transactions.dealershipId, f.dealershipId));
  if (f.category) conds.push(eq(transactions.category, f.category));
  if (f.recon) conds.push(eq(transactions.reconciliationStatus, f.recon));
  return db
    .select({ t: transactions, dealershipName: dealerships.name })
    .from(transactions)
    .innerJoin(dealerships, eq(dealerships.id, transactions.dealershipId))
    .where(and(...conds))
    .orderBy(desc(transactions.businessDate), desc(transactions.createdAt))
    .limit(1000);
}

/* ───────────────────────── CSV import ───────────────────────── */

export const IMPORT_COLUMNS = [
  "business_date", "dealership_code", "category", "kind", "parts_channel", "revenue_amount", "tax_amount",
  "direct_cost_amount", "units", "invoice_ref", "source_ref",
] as const;

export interface ImportRowResult {
  row: number;
  status: "accepted" | "rejected" | "duplicate";
  message?: string;
}

/**
 * Validated import of revenue lines (spreadsheets, registers, system exports).
 * - Required columns: see IMPORT_COLUMNS (header row, any order). source_ref must be unique per line.
 * - Every row is validated with the same rules as manual entry.
 * - Rows whose source_ref already exists are reported as duplicates and skipped (idempotent re-import).
 * - dryRun = true validates without writing (preview).
 */
export async function importTransactionsCsv(db: DB, actor: Actor, fileName: string, csvText: string, opts: { dryRun?: boolean } = {}) {
  assertCan(actor, "imports.run");
  const { header, rows } = parseCsv(csvText);
  const missing = IMPORT_COLUMNS.filter((c) => !["tax_amount", "direct_cost_amount", "units", "parts_channel"].includes(c) && !header.includes(c));
  if (missing.length) throw new ValidationError([`Missing required column(s): ${missing.join(", ")}`]);
  if (rows.length > 20_000) throw new ValidationError(["File is too large — split into files of 20,000 rows or fewer"]);

  const dealers = await db.select().from(dealerships).where(demoFilter(dealerships.isDemo));
  const byCode = new Map(dealers.map((d) => [d.code.toUpperCase(), d]));
  const today = businessDate();
  const results: ImportRowResult[] = [];
  const valid: (typeof transactions.$inferInsert)[] = [];
  const seenRefs = new Set<string>();

  rows.forEach((r, i) => {
    const rowNo = i + 2; // 1-based incl. header
    const get = (c: string) => (r[header.indexOf(c)] ?? "").trim();
    const num = (c: string) => (get(c) === "" ? null : Number(get(c).replace(/,/g, "")));
    const dealer = byCode.get(get("dealership_code").toUpperCase());
    const errs: string[] = [];
    if (!dealer) errs.push(`Unknown dealership_code "${get("dealership_code")}"`);
    else if (dealershipScope(actor) !== "all" && !actor.dealershipIds.includes(dealer.id)) errs.push("Dealership outside your access scope");
    const category = get("category") as RevenueCategory;
    const kind = (get("kind") || "invoice") as TxnKind;
    if (!REVENUE_CATEGORIES.includes(category)) errs.push(`Unknown category "${get("category")}"`);
    if (!TXN_KINDS.includes(kind)) errs.push(`Unknown kind "${get("kind")}"`);
    const sourceRef = get("source_ref");
    if (!sourceRef) errs.push("source_ref is required");
    if (sourceRef && seenRefs.has(sourceRef)) errs.push("source_ref repeated within this file");
    const input: TransactionInput = {
      businessDate: get("business_date"),
      category,
      kind,
      revenueAmount: num("revenue_amount") ?? NaN,
      taxAmount: num("tax_amount"),
      directCostAmount: num("direct_cost_amount"),
      partsChannel: (get("parts_channel") || null) as TransactionInput["partsChannel"],
      units: num("units"),
      invoiceRef: get("invoice_ref") || null,
    };
    const v = validateTransaction(input, today);
    errs.push(...v.errors);
    if (errs.length) {
      results.push({ row: rowNo, status: "rejected", message: errs.join("; ") });
      return;
    }
    seenRefs.add(sourceRef);
    const n = v.normalised;
    valid.push({
      businessDate: n.businessDate, dealershipId: dealer!.id, legalEntityId: dealer!.legalEntityId, brandId: dealer!.brandId,
      category: n.category, kind: n.kind, partsChannel: n.partsChannel ?? null, revenueAmount: n.revenueAmount, taxAmount: n.taxAmount ?? null,
      directCostAmount: n.directCostAmount ?? null, units: n.units ?? null, invoiceRef: n.invoiceRef ?? null,
      source: "import", sourceRef, createdById: actor.id, isDemo: dealer!.isDemo,
    });
    results.push({ row: rowNo, status: "accepted" });
  });

  // Duplicate detection against existing data
  const refs = valid.map((v) => v.sourceRef);
  const existing = new Set<string>();
  for (let i = 0; i < refs.length; i += 1000) {
    const chunk = refs.slice(i, i + 1000);
    if (!chunk.length) continue;
    const found = await db.select({ r: transactions.sourceRef }).from(transactions).where(and(eq(transactions.source, "import"), inArray(transactions.sourceRef, chunk)));
    found.forEach((f) => existing.add(f.r));
  }
  let vi = 0;
  for (const res of results) {
    if (res.status !== "accepted") continue;
    const v = valid[vi++];
    if (existing.has(v.sourceRef)) {
      res.status = "duplicate";
      res.message = `source_ref ${v.sourceRef} already imported`;
    }
  }
  const toInsert = valid.filter((v) => !existing.has(v.sourceRef));
  const summary = {
    rowsTotal: results.length,
    rowsAccepted: toInsert.length,
    rowsRejected: results.filter((r) => r.status === "rejected").length,
    rowsDuplicate: results.filter((r) => r.status === "duplicate").length,
  };
  if (opts.dryRun) return { batchId: null, ...summary, results };

  const batchId = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DB;
    const [batch] = await tx
      .insert(importBatches)
      .values({ kind: "transactions", fileName, ...summary, errors: results.filter((r) => r.status !== "accepted").map((r) => ({ row: r.row, message: `${r.status}: ${r.message}` })).slice(0, 500), createdById: actor.id })
      .returning();
    for (let i = 0; i < toInsert.length; i += 500) {
      await tx.insert(transactions).values(toInsert.slice(i, i + 500).map((v) => ({ ...v, importBatchId: batch.id }))).onConflictDoNothing();
    }
    await audit(tx, { userId: actor.id, action: "import.transactions", entityType: "import_batch", entityId: batch.id, after: { fileName, ...summary } });
    return batch.id;
  });
  return { batchId, ...summary, results };
}

export async function listImportBatches(db: DB, actor: Actor) {
  assertCan(actor, "imports.run");
  return db.select({ b: importBatches, userName: users.name }).from(importBatches).leftJoin(users, eq(users.id, importBatches.createdById)).orderBy(desc(importBatches.createdAt)).limit(50);
}

/* ───────────────────────── Targets ───────────────────────── */

export async function upsertTarget(db: DB, actor: Actor, input: { dealershipId: string; month: string; revenueTarget: number | null; deliveriesTarget: number | null; approve: boolean }) {
  assertCan(actor, "targets.manage");
  assertDealership(actor, input.dealershipId);
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new ValidationError(["Month must be YYYY-MM"]);
  if (input.revenueTarget != null && !(input.revenueTarget >= 0)) throw new ValidationError(["Revenue target must be ≥ 0"]);
  if (input.deliveriesTarget != null && !(Number.isInteger(input.deliveriesTarget) && input.deliveriesTarget >= 0)) throw new ValidationError(["Deliveries target must be a whole number ≥ 0"]);
  const [before] = await db.select().from(targets).where(and(eq(targets.dealershipId, input.dealershipId), eq(targets.month, input.month)));
  const values = {
    dealershipId: input.dealershipId,
    month: input.month,
    revenueTarget: input.revenueTarget,
    deliveriesTarget: input.deliveriesTarget,
    approvedById: input.approve ? actor.id : null,
    approvedAt: input.approve ? new Date() : null,
    isDemo: (await db.select({ d: dealerships.isDemo }).from(dealerships).where(eq(dealerships.id, input.dealershipId)))[0]?.d ?? false,
  };
  const [row] = await db.insert(targets).values(values).onConflictDoUpdate({ target: [targets.dealershipId, targets.month], set: values }).returning();
  await audit(db, { userId: actor.id, action: "target.upsert", entityType: "target", entityId: row.id, dealershipId: input.dealershipId, before: before ?? null, after: row });
  return row;
}

export async function listTargets(db: DB, actor: Actor, months: string[]) {
  assertCan(actor, "financials.view");
  const conds: (SQL | undefined)[] = [inArray(targets.month, months), demoFilter(targets.isDemo)];
  const scope = dealershipScope(actor);
  if (scope !== "all") conds.push(scope.length ? inArray(targets.dealershipId, scope) : sql`false`);
  return db.select().from(targets).where(and(...conds));
}
