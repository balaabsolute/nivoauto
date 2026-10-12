import Link from "next/link";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth";
import { redirect } from "next/navigation";
import { reportStatusForDate } from "@/server/services/reporting";
import { can } from "@/domain/permissions";
import { addDays, businessDate, isIsoDate, formatDateShort } from "@/domain/periods";
import { CATEGORY_ORDER, CATEGORY_LABELS } from "@/domain/revenue";
import { formatInrCompact, formatInt, formatPct, formatDateTime } from "@/domain/format";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Chip, Notice, SeverityChip } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Icon } from "@/components/Icon";
import { saveDailyReportAction } from "./actions";
import { dailyReportData } from "./report-data";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "Daily report" };

export default async function DailyReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  if (!can(actor, "daily_report.submit") && !can(actor, "daily_report.group") && !can(actor, "dealership.dashboard")) redirect("/forbidden");
  const sp = await searchParams;
  const today = businessDate();
  const q = first(sp.date);
  const date = isIsoDate(q) && q! <= today ? q! : addDays(today, -1);
  const db = await getDb();
  const status = await reportStatusForDate(db, actor, date);
  const canSubmit = can(actor, "daily_report.submit");
  const canSee = can(actor, "dealership.dashboard");
  const showFin = can(actor, "financials.view");
  const data = canSee ? await dailyReportData(actor, date) : null;

  return (
    <>
      <PageHeader
        title="Daily report"
        subtitle={`Business day ${formatDateShort(date)}${date === today ? " (in progress)" : ""}`}
        actions={
          <>
            <Link href={`/reports/daily?date=${addDays(date, -1)}`} className="btn-secondary btn-sm">‹ Prev day</Link>
            {date < today && <Link href={`/reports/daily?date=${addDays(date, 1)}`} className="btn-secondary btn-sm">Next day ›</Link>}
            {canSee && <a href={`/reports/daily/export?date=${date}`} className="btn-secondary btn-sm"><Icon name="download" /> CSV</a>}
            {canSee && <PrintButton />}
          </>
        }
      />

      {canSubmit && (
        <div className="grid gap-4 md:grid-cols-2 mb-6 no-print">
          {status.filter((s) => s.dealer.hasSales).map(({ dealer, report }) => {
            const r = report?.r;
            return (
              <Panel
                key={dealer.id}
                title={`${dealer.name}: sales & capacity`}
                subtitle={r?.status === "submitted" ? `Submitted by ${report?.by ?? "—"} at ${formatDateTime(r.submittedAt)}` : r ? "Draft, not yet submitted" : "Not started"}
                actions={<Chip tone={r?.status === "submitted" ? "good" : r ? "warn" : "neutral"}>{r?.status === "submitted" ? "Submitted" : r ? "Draft" : "Missing"}</Chip>}
              >
                <ActionForm action={saveDailyReportAction} className="space-y-3">
                  <input type="hidden" name="dealershipId" value={dealer.id} />
                  <input type="hidden" name="businessDate" value={date} />
                  <div className="grid grid-cols-2 gap-3">
                    <label><span className="label">New leads</span><input name="leads" inputMode="numeric" defaultValue={r?.leads ?? ""} className="field" /></label>
                    <label><span className="label">Bookings</span><input name="bookings" inputMode="numeric" defaultValue={r?.bookings ?? ""} className="field" /></label>
                    <label><span className="label">Booking cancellations</span><input name="bookingCancellations" inputMode="numeric" defaultValue={r?.bookingCancellations ?? ""} className="field" /></label>
                    <label><span className="label">Expected deliveries, next 7 days</span><input name="expectedDeliveries7d" inputMode="numeric" defaultValue={r?.expectedDeliveries7d ?? ""} className="field" /></label>
                    <label className="col-span-2"><span className="label">Available service bay-hours today (only if different from the standard profile)</span><input name="availableBayHoursOverride" inputMode="decimal" defaultValue={r?.availableBayHoursOverride ?? ""} className="field" placeholder="e.g. a bay down for maintenance" /></label>
                    <label className="col-span-2"><span className="label">Notes for management</span><textarea name="notes" rows={2} defaultValue={r?.notes ?? ""} className="field" /></label>
                  </div>
                  <p className="text-xs text-ink-3">Revenue, deliveries and job figures come from job cards and transactions, so they aren’t entered here.</p>
                  <div className="flex gap-2">
                    <Submit name="intent" value="submit" pendingText="Submitting…">Submit report</Submit>
                    <Submit name="intent" value="draft" className="btn-secondary" pendingText="Saving…">Save draft</Submit>
                  </div>
                </ActionForm>
              </Panel>
            );
          })}
        </div>
      )}

      {data && (
        <section aria-label="Daily summary" className="space-y-4">
          <div className="hidden print:block">
            <h2 className="text-xl font-semibold">Kun Automobile: daily report for {formatDateShort(date)}</h2>
            {data.day.containsDemo && <p className="text-sm font-semibold">DEMO DATA: synthetic and illustrative, not Kun Automobile figures.</p>}
          </div>
          {data.day.total.freshness.stale && date >= addDays(today, -1) && <Notice tone="warn">Some dealerships have no new records recently; their figures may be incomplete.</Notice>}
          <Panel title="Dealership summary" subtitle={`Day figures with month-to-date (1–${Number(date.slice(8))} ${formatDateShort(date).split(" ")[1]}) for context. Generated from stored records.`} bodyClassName="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <th className="th">Dealership</th>
                    {showFin && <th className="th text-right">Revenue (day)</th>}
                    {showFin && <th className="th text-right">Revenue MTD</th>}
                    {showFin && <th className="th text-right">MTD vs target</th>}
                    <th className="th text-right">Delivered day / MTD</th>
                    <th className="th text-right">Leads / bookings</th>
                    <th className="th text-right">Service in / out</th>
                    <th className="th text-right">Open / overdue</th>
                    <th className="th text-right">Bay util.</th>
                    <th className="th">Report</th>
                  </tr>
                </thead>
                <tbody>
                  {data.day.dealers.map((r) => {
                    const m = data.mtd.dealers.find((x) => x.dealer.id === r.dealer.id)!;
                    const rep = status.find((s) => s.dealer.id === r.dealer.id)?.report?.r;
                    return (
                      <tr key={r.dealer.id} className="border-b border-line">
                        <td className="td font-medium">{r.dealer.name}</td>
                        {showFin && <td className="td text-right num">{formatInrCompact(r.revenue.total)}</td>}
                        {showFin && <td className="td text-right num">{formatInrCompact(m.revenue.total)}</td>}
                        {showFin && <td className="td text-right num">{formatPct(m.revenueTargetAchievementPct)}</td>}
                        <td className="td text-right num">{r.revenue.vehiclesDelivered} / {m.revenue.vehiclesDelivered}</td>
                        <td className="td text-right num">{r.pipeline.leads ?? "—"} / {r.pipeline.bookings ?? "—"}</td>
                        <td className="td text-right num">{r.service.opened} / {r.service.delivered}</td>
                        <td className="td text-right num">{r.service.openAtEnd + r.bodyshop.openAtEnd} / <span className={r.service.overdueAtEnd + r.bodyshop.overdueAtEnd ? "text-crit font-medium" : ""}>{r.service.overdueAtEnd + r.bodyshop.overdueAtEnd}</span></td>
                        <td className="td text-right num">{formatPct(r.capacity.service.utilisationPct)}</td>
                        <td className="td">{!r.dealer.hasSales ? "—" : <Chip tone={rep?.status === "submitted" ? "good" : rep ? "warn" : "crit"}>{rep?.status === "submitted" ? "Submitted" : rep ? "Draft" : "Missing"}</Chip>}</td>
                      </tr>
                    );
                  })}
                  {data.day.dealers.length > 1 && (
                    <tr className="bg-page font-semibold">
                      <td className="td">Total</td>
                      {showFin && <td className="td text-right num">{formatInrCompact(data.day.total.revenue.total)}</td>}
                      {showFin && <td className="td text-right num">{formatInrCompact(data.mtd.total.revenue.total)}</td>}
                      {showFin && <td className="td text-right num">{formatPct(data.mtd.total.revenueTargetAchievementPct)}</td>}
                      <td className="td text-right num">{data.day.total.revenue.vehiclesDelivered} / {data.mtd.total.revenue.vehiclesDelivered}</td>
                      <td className="td text-right num">{data.day.total.pipeline.leads ?? "—"} / {data.day.total.pipeline.bookings ?? "—"}</td>
                      <td className="td text-right num">{data.day.total.service.opened} / {data.day.total.service.delivered}</td>
                      <td className="td text-right num">{data.day.total.service.openAtEnd + data.day.total.bodyshop.openAtEnd} / {data.day.total.service.overdueAtEnd + data.day.total.bodyshop.overdueAtEnd}</td>
                      <td className="td text-right num">{formatPct(data.day.total.capacity.service.utilisationPct)}</td>
                      <td className="td" />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
          {showFin && (
            <Panel title="Revenue by category (day)" bodyClassName="px-0 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-line"><tr><th className="th">Dealership</th>{CATEGORY_ORDER.map((c) => <th key={c} className="th text-right">{CATEGORY_LABELS[c]}</th>)}<th className="th text-right">Gross profit</th></tr></thead>
                  <tbody>
                    {data.day.dealers.map((r) => (
                      <tr key={r.dealer.id} className="border-b border-line last:border-0">
                        <td className="td">{r.dealer.name}</td>
                        {CATEGORY_ORDER.map((c) => <td key={c} className="td text-right num">{formatInrCompact(r.revenue.byCategory[c])}</td>)}
                        <td className="td text-right num">{r.revenue.gp.amount != null ? <>{formatInrCompact(r.revenue.gp.amount)}{r.revenue.gp.status === "provisional" && <span className="text-warn text-xs"> prov.</span>}</> : <span className="text-xs text-ink-3">{r.revenue.gp.status === "insufficient" ? "cost incomplete" : "—"}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          <Panel title="Exceptions for the day">
            {(() => {
              const notes = status.filter((s) => s.report?.r.notes);
              const alerts = data.day.alerts.filter((a) => a.severity !== "info");
              if (!alerts.length && !notes.length) return <p className="text-sm text-ink-3">No exceptions or notes.</p>;
              return (
                <ul className="space-y-2 text-sm">
                  {alerts.map((a) => <li key={a.fingerprint} className="flex flex-wrap items-start gap-2"><SeverityChip severity={a.severity} /><span>{a.observedFact}</span></li>)}
                  {notes.map((n) => <li key={n.dealer.id}><span className="font-medium">{n.dealer.name} note:</span> {n.report!.r.notes}</li>)}
                </ul>
              );
            })()}
          </Panel>
        </section>
      )}
    </>
  );
}
