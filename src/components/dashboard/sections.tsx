import Link from "next/link";
import clsx from "clsx";
import type { Dashboard, UnitMetrics, AlertView, DealerRow } from "@/server/analytics";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/domain/revenue";
import { formatInr, formatInrCompact, formatPct, formatInt, formatHours, relativeTime, formatDate, formatDelta } from "@/domain/format";
import { describeEvidence } from "@/domain/alerts";
import { COMMON_STAGE_LABELS, BODYSHOP_COMMON_STAGES, SERVICE_COMMON_STAGES, type CommonStage } from "@/domain/workflow";
import { AGEING_BUCKETS } from "@/domain/kpi";
import { growthPct } from "@/domain/kpi";
import { Panel, Delta, SeverityChip, EmptyState, ProgressBar, DealerName } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { MixBars } from "./MixBars";
import type { DealerTableRow } from "./DealerTable";

/* ───────────── Headline KPI cards ───────────── */


type Tone = "good" | "warn" | "crit" | "petrol";
const toneFor = (pct: number | null): Tone => (pct == null ? "petrol" : pct >= 100 ? "good" : pct >= 90 ? "warn" : "crit");
const TONE_TEXT: Record<Tone, string> = { good: "text-good", warn: "text-warn", crit: "text-crit", petrol: "text-petrol" };

function KpiCard({ label, value, href, children, accent }: { label: string; value: React.ReactNode; href?: string; children?: React.ReactNode; accent?: Tone }) {
  const head = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-medium text-ink-2">{label}</h3>
        {href && <span className="text-xs text-petrol" aria-hidden>View →</span>}
      </div>
      <p className={clsx("mt-2 text-[30px] leading-none font-semibold tracking-tight num", accent && TONE_TEXT[accent])}>{value}</p>
    </>
  );
  return (
    <section className="panel p-4 min-w-0 flex flex-col">
      {href ? <Link href={href} className="block hover:opacity-90">{head}</Link> : head}
      {children && <div className="mt-3 space-y-2">{children}</div>}
    </section>
  );
}

function VsTarget({ pct, actual, target, fmt, unit }: { pct: number | null; actual: number; target: number | null; fmt: (n: number) => string; unit: string }) {
  if (pct == null || target == null) return <p className="text-xs text-ink-3">No approved {unit} target for this period</p>;
  const tone = toneFor(pct);
  return (
    <>
      <ProgressBar value={Math.min(pct, 100)} max={100} tone={tone} label={`${unit} vs target`} />
      <p className="text-xs text-ink-2 flex justify-between gap-2">
        <span>Target {fmt(target)}</span>
        <span className={clsx("font-medium num", TONE_TEXT[tone])}>{formatPct(pct)} achieved</span>
      </p>
      {actual < target && <p className="text-xs text-ink-3">{fmt(target - actual)} to go (pro-rated to the last completed day)</p>}
    </>
  );
}

/** Best performer = highest revenue achievement against approved target; falls back to growth, then revenue. */
export function bestDealer(rows: DealerRow[]) {
  const active = rows.filter((r) => r.revenue.total > 0);
  const byTarget = active.filter((r) => r.revenueTargetAchievementPct != null).sort((a, b) => b.revenueTargetAchievementPct! - a.revenueTargetAchievementPct! || b.revenue.total - a.revenue.total);
  if (byTarget.length) return { row: byTarget[0], runnerUp: byTarget[1] ?? null, basis: "target" as const };
  const byGrowth = active.filter((r) => r.revenueGrowthPct != null).sort((a, b) => b.revenueGrowthPct! - a.revenueGrowthPct!);
  if (byGrowth.length) return { row: byGrowth[0], runnerUp: byGrowth[1] ?? null, basis: "growth" as const };
  const byRev = [...active].sort((a, b) => b.revenue.total - a.revenue.total);
  return byRev.length ? { row: byRev[0], runnerUp: byRev[1] ?? null, basis: "revenue" as const } : null;
}

export function KpiCards({ m, dealers, showFinancials, jobsHref, query, dealerCard }: { m: UnitMetrics; dealers?: DealerRow[]; showFinancials: boolean; jobsHref: string; query?: string; dealerCard?: React.ReactNode }) {
  const open = m.service.openAtEnd + m.bodyshop.openAtEnd;
  const overdue = m.service.overdueAtEnd + m.bodyshop.overdueAtEnd;
  const overduePct = open ? (overdue / open) * 100 : null;
  const best = dealers ? bestDealer(dealers) : null;
  const deliveredTargetActual = m.deliveriesTarget != null && m.deliveriesAchievementPct != null ? (m.deliveriesAchievementPct / 100) * m.deliveriesTarget : m.revenue.vehiclesDelivered;
  return (
    <div className={clsx("grid gap-4 sm:grid-cols-2", showFinancials ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
      {showFinancials && (
        <KpiCard label="Total revenue vs target" value={formatInrCompact(m.revenue.total)}>
          <Delta value={m.revenueGrowthPct} label="vs comparison period" />
          <VsTarget pct={m.revenueTargetAchievementPct} actual={m.revenue.total} target={m.revenueTarget} fmt={formatInrCompact} unit="revenue" />
          {m.revenueTargetAchievementPct != null && m.revenueTargetCoverage.withTarget < m.revenueTargetCoverage.total && (
            <p className="text-xs text-warn">Target set for {m.revenueTargetCoverage.withTarget} of {m.revenueTargetCoverage.total} dealerships</p>
          )}
        </KpiCard>
      )}
      <KpiCard label="Vehicles delivered vs target" value={formatInt(m.revenue.vehiclesDelivered)}>
        <Delta value={growthPct(m.revenue.vehiclesDelivered, m.revenuePrev.vehiclesDelivered || null)} label="vs comparison period" />
        <VsTarget pct={m.deliveriesAchievementPct} actual={deliveredTargetActual} target={m.deliveriesTarget} fmt={(n) => formatInt(Math.round(n))} unit="delivery" />
      </KpiCard>
      <KpiCard label="Open jobs vs overdue" value={<>{formatInt(open)} <span className="text-lg font-medium text-ink-3">/</span> <span className={clsx(overdue > 0 ? "text-crit" : "text-good")}>{formatInt(overdue)}</span></>} href={`${jobsHref}${jobsHref.includes("?") ? "&" : "?"}overdue=1`}>
        <ProgressBar value={overduePct} max={100} tone={overdue === 0 ? "good" : (overduePct ?? 0) > 20 ? "crit" : "warn"} label="Share of open jobs overdue" />
        <p className="text-xs text-ink-2 flex justify-between gap-2"><span>{overduePct == null ? "No open jobs" : `${formatPct(overduePct)} of open jobs overdue`}</span></p>
        <p className="text-xs text-ink-3">Service {formatInt(m.service.openAtEnd)} open · {formatInt(m.service.overdueAtEnd)} overdue<br />Body shop {formatInt(m.bodyshop.openAtEnd)} open · {formatInt(m.bodyshop.overdueAtEnd)} overdue</p>
      </KpiCard>
      {dealerCard ?? (best ? (
        <KpiCard label="Best performing dealership" value={<span className="text-[24px]"><DealerName name={best.row.dealer.name} color={best.row.dealer.color} /></span>} href={`/dealerships/${best.row.dealer.id}${query ? `?${query}` : ""}`}>
          <p className="text-sm">
            {best.basis === "target" ? <><span className="font-semibold text-good num">{formatPct(best.row.revenueTargetAchievementPct)}</span> of revenue target</>
              : best.basis === "growth" ? <><span className="font-semibold text-good num">{formatDelta(best.row.revenueGrowthPct)}</span> revenue growth</>
              : <>Highest revenue</>}
            {showFinancials && <span className="text-ink-2"> · {formatInrCompact(best.row.revenue.total)}</span>}
          </p>
          <p className="text-xs text-ink-3">{formatInt(best.row.revenue.vehiclesDelivered)} vehicles delivered{best.row.deliveriesAchievementPct != null ? ` (${formatPct(best.row.deliveriesAchievementPct)} of target)` : ""}</p>
          {best.runnerUp && <p className="text-xs text-ink-3 border-t border-line pt-2">Next: <DealerName name={best.runnerUp.dealer.name} color={best.runnerUp.dealer.color} size="sm" />{best.basis === "target" ? ` · ${formatPct(best.runnerUp.revenueTargetAchievementPct)}` : ""}</p>}
          <p className="text-[11px] text-ink-3">Ranked by {best.basis === "target" ? "revenue achieved against approved target" : best.basis === "growth" ? "revenue growth (no approved targets)" : "revenue"}</p>
        </KpiCard>
      ) : (
        <KpiCard label="Best performing dealership" value="—"><p className="text-xs text-ink-3">No revenue recorded for this period</p></KpiCard>
      ))}
    </div>
  );
}

/** Drill-down fourth card: workshop utilisation. */
export function UtilisationCard({ m }: { m: UnitMetrics }) {
  const u = m.capacity.service.utilisationPct;
  return (
    <KpiCard label="Service bay utilisation" value={formatPct(u)} accent={u == null ? undefined : u > 95 ? "crit" : u < 50 ? "warn" : undefined}>
      <ProgressBar value={u} max={100} tone={u == null ? "petrol" : u > 95 ? "crit" : u < 50 ? "warn" : "petrol"} label="Service bay utilisation" />
      <p className="text-xs text-ink-3">{m.capacity.service.units ? `${formatInt(m.capacity.service.used)} of ${formatInt(m.capacity.service.available)} productive hours, completed days` : "No capacity profile set"}</p>
    </KpiCard>
  );
}

/* ───────────── Revenue mix ───────────── */

export function RevenueMixPanel({ m }: { m: UnitMetrics }) {
  const rows = CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORY_LABELS[c], revenue: m.revenue.byCategory[c] }));
  const ex = m.revenue.excluded;
  return (
    <Panel title="Revenue mix" subtitle="Each invoice line counted once, ex-tax">
      {m.revenue.lineCount === 0 ? (
        <EmptyState title="No revenue recorded for this period">Revenue appears once transactions are entered or imported.</EmptyState>
      ) : (
        <>
          <MixBars rows={rows} total={m.revenue.total} />
          <p className="text-xs text-ink-3 mt-4 border-t border-line pt-2">
            Parts: {formatInrCompact(m.parts.retail)} retail · {formatInrCompact(m.parts.workshop)} used in workshop jobs.
            {(ex.bookingAdvances !== 0 || ex.intercompany !== 0) && (
              <> Excluded from revenue: {formatInrCompact(ex.bookingAdvances)} booking advances{ex.intercompany ? `, ${formatInrCompact(ex.intercompany)} intercompany` : ""}.</>
            )}
          </p>
        </>
      )}
    </Panel>
  );
}

/* ───────────── Sales pipeline ───────────── */

export function PipelinePanel({ m }: { m: UnitMetrics }) {
  const p = m.pipeline;
  const items = [
    { label: "Leads", v: p.leads },
    { label: "Bookings", v: p.bookings },
    { label: "Cancellations", v: p.cancellations },
    { label: "Expected deliveries, next 7 days", v: p.expectedDeliveries7d },
  ];
  return (
    <Panel title="Sales pipeline" subtitle="From dealership daily reports">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {items.map((i) => (
          <div key={i.label}>
            <dt className="text-xs text-ink-2">{i.label}</dt>
            <dd className="text-xl font-semibold num">{i.v == null ? <span className="text-ink-3 text-sm font-normal">Not reported</span> : formatInt(i.v)}</dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-ink-2">Deliveries vs target</dt>
          <dd className="text-xl font-semibold num">{m.deliveriesAchievementPct == null ? <span className="text-ink-3 text-sm font-normal">No target</span> : formatPct(m.deliveriesAchievementPct)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-2">Booking conversion</dt>
          <dd className="text-xl font-semibold num">{p.leads && p.bookings != null ? formatPct((p.bookings / p.leads) * 100) : "—"}</dd>
        </div>
      </dl>
      <p className="text-xs text-ink-3 mt-3 border-t border-line pt-2">
        {p.reportsExpected ? `${p.reportsSubmitted} of ${p.reportsExpected} expected daily reports submitted for completed days.` : "Daily-report coverage is measured once a day has closed."}
      </p>
    </Panel>
  );
}

/* ───────────── Showroom funnel (front desk + enquiries) ───────────── */

export function ShowroomPanel({ m, href = "/leads/performance" }: { m: UnitMetrics; href?: string }) {
  const f = m.showroom;
  if (!f.walkInsTotal && !f.enquiries && !f.closed && !f.openAtEnd) {
    return (
      <Panel title="Showroom" subtitle="Walk-ins and car enquiries">
        <EmptyState title="No showroom activity in this period" icon="car">Walk-ins appear once the showroom kiosk or front desk is in use.</EmptyState>
      </Panel>
    );
  }
  const items: [string, React.ReactNode][] = [
    ["Walk-ins", formatInt(f.walkInsTotal)],
    ["New-car enquiries", formatInt(f.enquiries)],
    ["Test drives done", formatInt(f.testDrives)],
    ["Test-drive rate", formatPct(f.testDriveRatePct)],
    ["Sold (won)", formatInt(f.won)],
    ["Close rate", formatPct(f.closeRatePct)],
  ];
  return (
    <Panel title="Showroom" subtitle="From the kiosk, front desk and enquiry records" actions={<Link href={href} className="text-sm text-petrol hover:underline">Sales performance</Link>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {items.map(([l, v]) => (
          <div key={l}><dt className="text-xs text-ink-2">{l}</dt><dd className="text-xl font-semibold num">{v}</dd></div>
        ))}
      </dl>
      <p className="text-xs text-ink-3 mt-3 border-t border-line pt-2">
        Visits: {f.walkIns.new_car} new car · {f.walkIns.service} service · {f.walkIns.spare_parts} parts · {f.walkIns.body_shop} body shop.
        {" "}Closed: {f.won} sold, {f.lostOtherDealer} bought elsewhere, {f.notInterested} not interested, {f.optedOut} opted out. {f.openAtEnd} open at period end.
      </p>
    </Panel>
  );
}

/* ───────────── Operational health ───────────── */

export function OperationalHealthPanel({ m, hasBodyShop = true }: { m: UnitMetrics; hasBodyShop?: boolean }) {
  const s = m.service;
  const cap = m.capacity.service;
  const totalAge = AGEING_BUCKETS.reduce((a, b) => a + s.ageing[b.key], 0);
  const AGE_COLORS = ["#b7d3f6", "#6da7ec", "#2a78d6", "#184f95"];
  return (
    <Panel title="Operational health" subtitle="Service workshop now, and over the period">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        <div><dt className="text-xs text-ink-2">Jobs opened / delivered</dt><dd className="text-lg font-semibold num">{formatInt(s.opened)} / {formatInt(s.delivered)}</dd></div>
        <div><dt className="text-xs text-ink-2">On-time delivery</dt><dd className="text-lg font-semibold num">{formatPct(s.onTimePct)}</dd><dd className="text-xs text-ink-3">{s.onTimeBase ? `of ${s.onTimeBase} with a promise` : "no promised jobs delivered"}</dd></div>
        <div><dt className="text-xs text-ink-2">Average turnaround</dt><dd className="text-lg font-semibold num">{formatHours(s.avgTurnaroundHours)}</dd></div>
        <div>
          <dt className="text-xs text-ink-2">Bay utilisation</dt>
          <dd className="text-lg font-semibold num">{cap.utilisationPct == null ? <span className="text-sm font-normal text-ink-3">{cap.units ? "After day close" : "No capacity set"}</span> : formatPct(cap.utilisationPct)}</dd>
          {cap.utilisationPct != null && <dd className="text-xs text-ink-3 num">{formatInt(cap.used)} of {formatInt(cap.available)} productive h</dd>}
        </div>
      </dl>
      <div className="mt-4">
        <p className="text-xs text-ink-2 mb-1.5">Open service jobs by age ({formatInt(totalAge)})</p>
        {totalAge === 0 ? <p className="text-sm text-ink-3">No open service jobs.</p> : (
          <>
            <div className="flex h-3 rounded overflow-hidden gap-[2px]" role="img" aria-label={AGEING_BUCKETS.map((b) => `${b.label}: ${s.ageing[b.key]}`).join(", ")}>
              {AGEING_BUCKETS.map((b, i) => s.ageing[b.key] > 0 && <div key={b.key} style={{ width: `${(s.ageing[b.key] / totalAge) * 100}%`, background: AGE_COLORS[i] }} />)}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-ink-2">
              {AGEING_BUCKETS.map((b, i) => (
                <li key={b.key} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: AGE_COLORS[i] }} />{b.label} <span className="num font-medium text-ink">{s.ageing[b.key]}</span></li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Waiting on parts", v: s.waiting.parts + (hasBodyShop ? m.bodyshop.waiting.parts : 0) },
          { label: "Waiting on approval", v: s.waiting.approval + (hasBodyShop ? m.bodyshop.waiting.approval : 0) },
          { label: "Other blockers", v: s.waiting.other + (hasBodyShop ? m.bodyshop.waiting.other : 0) },
        ].map((x) => (
          <div key={x.label} className="rounded bg-page px-2 py-2">
            <p className="text-lg font-semibold num">{x.v}</p>
            <p className="text-xs text-ink-2">{x.label}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function StageQueue({ wip, stages, title, subtitle, href }: { wip: Record<string, number>; stages: readonly string[]; title: string; subtitle?: string; href?: string }) {
  const visible = stages.filter((s) => s !== "delivered");
  const max = Math.max(1, ...visible.map((s) => wip[s] ?? 0));
  const total = visible.reduce((a, s) => a + (wip[s] ?? 0), 0);
  return (
    <Panel title={title} subtitle={subtitle} actions={href ? <Link href={href} className="text-sm text-petrol hover:underline">Open board</Link> : undefined}>
      {total === 0 ? <p className="text-sm text-ink-3">No vehicles in progress.</p> : (
        <ul className="space-y-1.5">
          {visible.map((s) => (
            <li key={s} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-2 text-sm">
              <span className="truncate text-ink-2">{COMMON_STAGE_LABELS[s as CommonStage]}</span>
              <span className="h-2 rounded-r bg-line/50"><span className="block h-full rounded-r bg-petrol" style={{ width: `${((wip[s] ?? 0) / max) * 100}%` }} /></span>
              <span className="num text-right font-medium">{wip[s] ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function BodyShopPanel({ m }: { m: UnitMetrics }) {
  const b = m.bodyshop;
  return (
    <Panel title="Body shop" subtitle="Repair cycle and capacity">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div><dt className="text-xs text-ink-2">Awaiting assessment</dt><dd className="text-lg font-semibold num">{formatInt((m.bodyshopWip.intake ?? 0) + (m.bodyshopWip.assessment ?? 0))}</dd></div>
        <div><dt className="text-xs text-ink-2">Waiting approval / parts</dt><dd className="text-lg font-semibold num">{formatInt(b.waiting.approval)} / {formatInt(b.waiting.parts)}</dd></div>
        <div><dt className="text-xs text-ink-2">Average repair cycle</dt><dd className="text-lg font-semibold num">{formatHours(b.avgTurnaroundHours)}</dd></div>
        <div><dt className="text-xs text-ink-2">Overdue promised deliveries</dt><dd className={clsx("text-lg font-semibold num", b.overdueAtEnd > 0 && "text-crit")}>{formatInt(b.overdueAtEnd)}</dd></div>
        <div><dt className="text-xs text-ink-2">Paint booth utilisation</dt><dd className="text-lg font-semibold num">{formatPct(m.capacity.paint.utilisationPct)}</dd></div>
        <div><dt className="text-xs text-ink-2">Body bay utilisation</dt><dd className="text-lg font-semibold num">{formatPct(m.capacity.body.utilisationPct)}</dd></div>
      </dl>
      {m.bodyshopRevenuePerJob != null && <p className="text-xs text-ink-3 mt-3 border-t border-line pt-2">Average revenue per delivered body shop job: {formatInr(m.bodyshopRevenuePerJob)}</p>}
    </Panel>
  );
}

/* ───────────── Management insights ───────────── */

export function InsightsPanel({ alerts, limit = 6, showDealer = true, grid = false, colors }: { alerts: AlertView[]; limit?: number; showDealer?: boolean; grid?: boolean; colors?: Record<string, string> }) {
  const shown = alerts.filter((a) => a.status !== "resolved" && a.status !== "dismissed").slice(0, limit);
  return (
    <Panel
      title="Management insights"
      subtitle="Rule-based exceptions. They state what the data shows, not the cause."
      actions={<Link href="/alerts" className="text-sm text-petrol hover:underline whitespace-nowrap">All actions</Link>}
      bodyClassName="px-0 pb-1"
    >
      {!shown.length ? (
        <EmptyState title="No exceptions for this period" icon="check">Every rule is within its threshold. Thresholds are listed in the KPI definitions.</EmptyState>
      ) : (
        <ul className={clsx(grid ? "grid gap-3 px-4 pb-3 md:grid-cols-2 xl:grid-cols-3" : "divide-y divide-line")}>
          {shown.map((a) => (
            <li key={a.fingerprint} className={clsx(grid ? "rounded-lg border border-line p-3 border-l-4" : "px-4 py-3", grid && (a.severity === "critical" ? "border-l-crit" : a.severity === "warning" ? "border-l-warn" : "border-l-petrol"))}>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityChip severity={a.severity} />
                <span className="font-medium text-sm">{a.title}</span>
                {showDealer && a.dealershipName && <span className="text-xs text-ink-3">{colors?.[a.dealershipName] ? <DealerName name={a.dealershipName} color={colors[a.dealershipName]} size="sm" /> : a.dealershipName}</span>}
              </div>
              <p className="text-sm text-ink-2 mt-1">{a.observedFact}</p>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-petrol">Evidence &amp; what to check</summary>
                <ul className="mt-1 text-ink-2 space-y-0.5">
                  {describeEvidence(a.evidence).map((e) => <li key={e} className="num">{e}</li>)}
                  <li>Source: {a.source} · Period: {a.periodLabel}</li>
                </ul>
                <p className="mt-1 text-ink">Suggested investigation: {a.suggestedInvestigation}</p>
              </details>
              <p className="text-xs text-ink-3 mt-1">
                {a.ownerName ? <>Owner {a.ownerName}{a.dueDate && <>, due {formatDate(a.dueDate)}</>}</> : <span className="text-warn">No owner assigned</span>}
                {" · "}{a.status.replace("_", " ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────── Data freshness / completeness ───────────── */

export function FreshnessStrip({ d, scopeLabel }: { d: Dashboard; scopeLabel: string }) {
  const f = d.total.freshness;
  const staleDealers = d.dealers.filter((r) => r.freshness.stale && r.freshness.hasAnyData);
  const lastUpdate = [f.lastTransactionAt, f.lastJobActivityAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
  const items = [
    { label: "Last update", value: relativeTime(lastUpdate), warn: f.stale },
    { label: "Reporting coverage", value: `${d.coverage.dealershipsReporting} of ${d.coverage.dealershipsTotal} ${scopeLabel}`, warn: d.coverage.dealershipsReporting < d.coverage.dealershipsTotal },
  ];
  return (
    <section aria-label="Data freshness and completeness" className="mb-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded border border-line bg-panel px-3 py-2 text-xs">
        <span className="font-medium text-ink flex items-center gap-1.5"><Icon name="clock" className="h-3.5 w-3.5" /> Data status</span>
        {items.map((i) => (
          <span key={i.label} className="text-ink-2">
            {i.label} <span className={clsx("font-medium num", i.warn ? "text-warn" : "text-ink")}>{i.value}</span>
          </span>
        ))}
      </div>
      {staleDealers.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {staleDealers.length > 0 && (
            <li className="text-warn flex items-start gap-1.5"><Icon name="alert" className="h-3.5 w-3.5 mt-px shrink-0" />No new records in the last {Math.round(Number(process.env.STALE_AFTER_HOURS ?? 36))} hours from {staleDealers.map((s) => s.dealer.name).join(", ")}. Their figures may be incomplete.</li>
          )}
        </ul>
      )}
    </section>
  );
}

/* ───────────── Row mapping for the comparison table ───────────── */

export function toTableRows(rows: DealerRow[]): DealerTableRow[] {
  return rows.map((r) => {
    const active = r.alerts.filter((a) => a.status !== "resolved" && a.status !== "dismissed");
    return {
      id: r.dealer.id,
      name: r.dealer.name,
      color: r.dealer.color,
      brand: r.dealer.brand,
      entity: r.dealer.legalEntity,
      location: r.dealer.location,
      revenue: r.revenue.total,
      revenueGrowth: r.revenueGrowthPct,
      targetPct: r.revenueTargetAchievementPct,
      deliveredPct: r.deliveriesAchievementPct,
      delivered: r.revenue.vehiclesDelivered,
      serviceOpen: r.service.openAtEnd,
      serviceOverdue: r.service.overdueAtEnd,
      utilisation: r.capacity.service.utilisationPct,
      bodyWip: r.dealer.hasBodyShop ? r.bodyshop.openAtEnd : null,
      bodyOverdue: r.dealer.hasBodyShop ? r.bodyshop.overdueAtEnd : null,
      signal: r.signal,
      alertCount: active.filter((a) => a.severity !== "info").length,
      stale: r.freshness.stale && r.freshness.hasAnyData,
      topAlert: active.find((a) => a.severity !== "info")?.title ?? null,
    };
  });
}

export { SERVICE_COMMON_STAGES, BODYSHOP_COMMON_STAGES };
