import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listTransactions } from "@/server/services/finance";
import { loadDealers } from "@/server/analytics";
import { can, dealershipScope } from "@/domain/permissions";
import { addDays, businessDate, isIsoDate } from "@/domain/periods";
import { CATEGORY_LABELS, CATEGORY_ORDER, summariseRevenue } from "@/domain/revenue";
import { formatInr, formatInrCompact, formatPct } from "@/domain/format";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Chip, EmptyState } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Icon } from "@/components/Icon";
import { manualTxnAction, reconAction } from "./actions";
import type { RevenueCategory, ReconStatus } from "@/db/schema";

export const metadata = { title: "Finance & targets" };
const KIND = { invoice: "Invoice", credit_note: "Credit note", booking_advance: "Booking advance (not revenue)", intercompany: "Intercompany (excluded)" } as const;

export default async function FinancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("financials.view");
  const sp = await searchParams;
  const today = businessDate();
  const from = isIsoDate(first(sp.from)) ? first(sp.from)! : addDays(today, -6);
  const to = isIsoDate(first(sp.to)) ? first(sp.to)! : today;
  const dealer = first(sp.dealer);
  const category = first(sp.category) as RevenueCategory | undefined;
  const recon = first(sp.recon) as ReconStatus | undefined;
  const db = await getDb();
  const [rows, dealers] = await Promise.all([listTransactions(db, actor, { from, to, dealershipId: dealer, category, recon }), loadDealers(db, dealershipScope(actor))]);
  const sum = summariseRevenue(rows.map((r) => r.t));
  const canEnter = can(actor, "transactions.manage");
  const canRecon = can(actor, "reconciliation.manage");

  return (
    <>
      <PageHeader
        title="Finance & targets"
        subtitle="Revenue lines behind every dashboard figure"
        actions={
          <>
            {can(actor, "imports.run") && <Link href="/finance/import" className="btn-secondary"><Icon name="upload" /> Import CSV</Link>}
            <Link href="/finance/targets" className="btn-secondary">Targets</Link>
          </>
        }
      />
      <form action="/finance" className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-xs text-ink-2">From<input type="date" name="from" defaultValue={from} max={today} className="field mt-0.5" /></label>
        <label className="text-xs text-ink-2">To<input type="date" name="to" defaultValue={to} max={today} className="field mt-0.5" /></label>
        {dealers.length > 1 && <label className="text-xs text-ink-2">Dealership<select name="dealer" defaultValue={dealer ?? ""} className="field mt-0.5"><option value="">All</option>{dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        <label className="text-xs text-ink-2">Category<select name="category" defaultValue={category ?? ""} className="field mt-0.5"><option value="">All</option>{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></label>
        <label className="text-xs text-ink-2">Reconciliation<select name="recon" defaultValue={recon ?? ""} className="field mt-0.5"><option value="">All</option><option value="unreconciled">Unreconciled</option><option value="reconciled">Reconciled</option><option value="disputed">Disputed</option></select></label>
        <button className="btn-secondary">Apply</button>
      </form>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4">
          <dl className="panel grid grid-cols-2 sm:grid-cols-4 divide-x divide-line">
            <div className="p-3"><dt className="text-xs text-ink-2">Revenue (filtered)</dt><dd className="text-lg font-semibold num">{formatInrCompact(sum.total)}</dd></div>
            <div className="p-3"><dt className="text-xs text-ink-2">Gross profit</dt><dd className="text-lg font-semibold num">{sum.gp.amount != null ? formatInrCompact(sum.gp.amount) : "—"}</dd><dd className="text-xs text-ink-3">{sum.gp.status === "provisional" ? "provisional" : sum.gp.status === "insufficient" ? "cost data incomplete" : ""}</dd></div>
            <div className="p-3"><dt className="text-xs text-ink-2">Reconciled</dt><dd className="text-lg font-semibold num">{formatPct(sum.reconciledPct)}</dd></div>
            <div className="p-3"><dt className="text-xs text-ink-2">Excluded (advances / intercompany)</dt><dd className="text-lg font-semibold num">{formatInrCompact(sum.excluded.bookingAdvances + sum.excluded.intercompany)}</dd></div>
          </dl>
          <Panel title="Revenue lines" subtitle={`${rows.length}${rows.length === 1000 ? "+ (first 1,000 shown; narrow the filters)" : ""} lines`} bodyClassName="px-0 pb-0">
            {!rows.length ? <EmptyState title="No lines for these filters" icon="coins">Enter a line manually or import a CSV export.</EmptyState> : (
              <div className="overflow-x-auto max-h-[640px]">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="border-b border-line sticky top-0 bg-panel"><tr><th className="th">Date</th><th className="th">Dealership</th><th className="th">Category / kind</th><th className="th">Reference</th><th className="th text-right">Revenue (ex-tax)</th><th className="th text-right">Direct cost</th><th className="th">Source</th><th className="th">Reconciliation</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 400).map(({ t, dealershipName }) => (
                      <tr key={t.id} className="border-b border-line last:border-0">
                        <td className="td whitespace-nowrap">{t.businessDate}</td>
                        <td className="td">{dealershipName}</td>
                        <td className="td">{CATEGORY_LABELS[t.category]}{t.partsChannel ? ` (${t.partsChannel})` : ""}{t.kind !== "invoice" && <div className="text-xs text-warn">{KIND[t.kind]}</div>}</td>
                        <td className="td text-xs">{t.invoiceRef}{t.jobId && <Link href={`/jobs/${t.jobId}`} className="block text-petrol">job</Link>}</td>
                        <td className="td text-right num">{formatInr(t.revenueAmount)}</td>
                        <td className="td text-right num">{t.directCostAmount == null ? <span className="text-xs text-warn">missing</span> : formatInr(t.directCostAmount)}</td>
                        <td className="td text-xs">{t.source}</td>
                        <td className="td">
                          {canRecon ? (
                            <ActionForm action={reconAction} className="flex items-center gap-1">
                              <input type="hidden" name="id" value={t.id} />
                              <select name="status" defaultValue={t.reconciliationStatus} className="field h-8 text-xs w-auto" aria-label="Reconciliation status"><option value="unreconciled">Unreconciled</option><option value="reconciled">Reconciled</option><option value="disputed">Disputed</option></select>
                              <Submit className="btn-ghost btn-sm">Set</Submit>
                            </ActionForm>
                          ) : <Chip tone={t.reconciliationStatus === "reconciled" ? "good" : t.reconciliationStatus === "disputed" ? "crit" : "neutral"}>{t.reconciliationStatus}</Chip>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 400 && <p className="text-xs text-ink-3 p-3">Showing 400 of {rows.length} lines; totals above include all of them.</p>}
              </div>
            )}
          </Panel>
        </div>
        {canEnter && (
          <Panel title="Record a revenue line" subtitle="Controlled manual entry, audited. Split bundled invoices into labour and parts lines.">
            <ActionForm action={manualTxnAction} resetOnSuccess className="space-y-3">
              <label className="block"><span className="label">Dealership</span><select name="dealershipId" className="field">{dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">Business date</span><input type="date" name="businessDate" defaultValue={today} max={today} className="field" required /></label>
                <label><span className="label">Invoice / CN ref</span><input name="invoiceRef" className="field" required /></label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">Category</span><select name="category" className="field">{CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></label>
                <label><span className="label">Kind</span><select name="kind" className="field">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              </div>
              <label className="block"><span className="label">Parts channel (parts lines only)</span><select name="partsChannel" className="field"><option value="">—</option><option value="retail">Retail counter</option><option value="workshop">Used in workshop job</option></select></label>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">Revenue ex-tax (₹)</span><input name="revenueAmount" inputMode="decimal" required className="field" /></label>
                <label><span className="label">Tax (₹)</span><input name="taxAmount" inputMode="decimal" className="field" /></label>
                <label><span className="label">Direct cost (₹)</span><input name="directCostAmount" inputMode="decimal" className="field" placeholder="Blank if unknown" /></label>
                <label><span className="label">Vehicles (sales only)</span><input name="units" inputMode="numeric" className="field" /></label>
              </div>
              <label className="block"><span className="label">Note</span><input name="notes" className="field" /></label>
              <Submit>Record line</Submit>
            </ActionForm>
          </Panel>
        )}
      </div>
    </>
  );
}
