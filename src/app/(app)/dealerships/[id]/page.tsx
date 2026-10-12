import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { buildDashboard } from "@/server/analytics";
import { listJobs } from "@/server/services/jobs";
import { periodFromParams, periodQuery, type SP } from "@/server/period-params";
import { businessDate, periodRangeLabel } from "@/domain/periods";
import { can, canAccessDealership, isGroupWide } from "@/domain/permissions";
import { formatInr, formatInrCompact, formatInt, formatPct, formatDateTime, formatHours } from "@/domain/format";
import { COMMON_STAGE_LABELS, type CommonStage } from "@/domain/workflow";
import { PageHeader, Panel, Chip, EmptyState, ProgressBar } from "@/components/ui";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { TrendChart } from "@/components/dashboard/TrendChart";
import {
  HeadlineFigures, RevenueMixPanel, PipelinePanel, OperationalHealthPanel, StageQueue, InsightsPanel, FreshnessStrip, BodyShopPanel, BODYSHOP_COMMON_STAGES, SERVICE_COMMON_STAGES,
} from "@/components/dashboard/sections";

export const metadata = { title: "Dealership" };

export default async function DealershipPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const actor = await requireCap("dealership.dashboard");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !canAccessDealership(actor, id)) notFound();
  const sp = await searchParams;
  const { period } = periodFromParams(sp);
  const db = await getDb();
  const d = await buildDashboard(db, actor, period, { dealershipIds: [id] });
  const row = d.dealers[0];
  if (!row) notFound();
  const m = row;
  const dealer = row.dealer;
  const showFin = can(actor, "financials.view");
  const overdue = (await listJobs(db, actor, { dealershipId: id, overdue: true })).slice(0, 8);
  const today = businessDate();
  const capacityRows = [
    { k: "service", l: "Service bays", c: m.capacity.service },
    ...(dealer.hasBodyShop ? [{ k: "body", l: "Body bays", c: m.capacity.body }, { k: "paint", l: "Paint booths", c: m.capacity.paint }] : []),
  ];

  return (
    <>
      <PageHeader
        back={isGroupWide(actor) ? { href: `/group?${periodQuery(period)}`, label: "Group overview" } : undefined}
        title={dealer.name}
        subtitle={
          <>
            {dealer.brand} · {dealer.legalEntity} · {dealer.location}
            <span className="block">
              {period.label}: {periodRangeLabel(period)}
              {period.end === today && " (today in progress)"} · compared with {period.comparison.label}
            </span>
          </>
        }
        actions={<PeriodSelector current={period.key} start={period.start} end={period.end} today={today} />}
      />
      <div className="space-y-4">
        <FreshnessStrip d={d} scopeLabel="dealership" />
        <HeadlineFigures m={m} showFinancials={showFin} jobsHref={`/jobs?dealer=${id}`} />

        {showFin && (
          <div className="grid gap-4 xl:grid-cols-3">
            <Panel className="xl:col-span-2" title="Revenue trend" subtitle={d.trendPeriod.key !== period.key ? `Month to date for context (${periodRangeLabel(d.trendPeriod)})` : "Cumulative"}>
              {d.trend.every((p) => !p.current) ? <EmptyState title="No revenue recorded in this window" /> : <TrendChart data={d.trend} comparisonLabel={d.trendPeriod.comparison.label} granularity={d.trendPeriod.granularity} />}
            </Panel>
            <RevenueMixPanel m={m} />
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <InsightsPanel alerts={row.alerts} showDealer={false} />
          <OperationalHealthPanel m={m} hasBodyShop={dealer.hasBodyShop} />
          {dealer.hasSales && <PipelinePanel m={m} />}
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <StageQueue wip={m.serviceWip} stages={SERVICE_COMMON_STAGES} title="Service stage queue" subtitle="Open jobs by stage now" href={`/jobs?dealer=${id}`} />
          <Panel title="Spare parts" subtitle="Sales and workshop dependency">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {showFin && <div><dt className="text-xs text-ink-2">Retail parts revenue</dt><dd className="text-lg font-semibold num">{formatInrCompact(m.parts.retail)}</dd></div>}
              {showFin && <div><dt className="text-xs text-ink-2">Parts used in workshop</dt><dd className="text-lg font-semibold num">{formatInrCompact(m.parts.workshop)}</dd></div>}
              {showFin && <div><dt className="text-xs text-ink-2">Parts gross margin</dt><dd className="text-lg font-semibold num">{["complete", "provisional"].includes(m.revenue.gpByCategory.parts.status) ? formatPct(m.revenue.gpByCategory.parts.marginPct) : "—"}</dd></div>}
              <div><dt className="text-xs text-ink-2">Part lines issued to jobs</dt><dd className="text-lg font-semibold num">{formatInt(m.parts.linesIssued)}</dd></div>
              <div><dt className="text-xs text-ink-2">Jobs delayed by parts now</dt><dd className="text-lg font-semibold num">{formatInt(m.parts.jobsDelayedByParts)}</dd></div>
            </dl>
            <p className="text-xs text-ink-3 mt-3 border-t border-line pt-2">Stock-outs and inventory ageing will be added once reliable inventory data is available.</p>
          </Panel>
          <Panel title="Capacity & workload" subtitle={m.capacity.service.completedThrough ? `Completed days to ${m.capacity.service.completedThrough}` : "Available after the first day closes"}>
            {capacityRows.map(({ k, l, c }) => (
              <div key={k} className="mb-3 last:mb-0">
                <div className="flex justify-between text-sm">
                  <span>{l} <span className="text-ink-3 text-xs">({c.units} units)</span></span>
                  <span className="num font-medium">{formatPct(c.utilisationPct)}</span>
                </div>
                <ProgressBar value={c.utilisationPct} max={100} label={`${l} utilisation`} tone={(c.utilisationPct ?? 0) > 95 ? "crit" : (c.utilisationPct ?? 0) < 50 ? "warn" : "petrol"} />
                <p className="text-xs text-ink-3 mt-0.5 num">{c.units ? `${formatInt(c.used)} of ${formatInt(c.available)} productive hours used` : "No capacity profile set"}</p>
              </div>
            ))}
            {m.serviceRevenuePerJob != null && showFin && <p className="text-xs text-ink-3 mt-2 border-t border-line pt-2">Average revenue per delivered service job: {formatInr(m.serviceRevenuePerJob)}</p>}
          </Panel>
        </div>

        {dealer.hasBodyShop && (
          <div className="grid gap-4 lg:grid-cols-2">
            <BodyShopPanel m={m} />
            <StageQueue wip={m.bodyshopWip} stages={BODYSHOP_COMMON_STAGES} title="Body shop stage queue" subtitle="Common reporting stages" href={`/bodyshop?dealer=${id}`} />
          </div>
        )}

        <Panel title="Overdue commitments" subtitle="Open jobs past the promised delivery time" actions={<Link href={`/jobs?dealer=${id}&overdue=1`} className="text-sm text-petrol hover:underline">View all</Link>} bodyClassName="px-0 pb-1">
          {!overdue.length ? (
            <EmptyState title="No overdue jobs" icon="check" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-line">
                  <tr><th className="th">Job</th><th className="th">Vehicle</th><th className="th">Stage</th><th className="th">Promised</th><th className="th">Blocker / reason</th></tr>
                </thead>
                <tbody>
                  {overdue.map((r) => (
                    <tr key={r.job.id} className="border-b border-line last:border-0">
                      <td className="td"><Link href={`/jobs/${r.job.id}`} className="text-petrol font-medium hover:underline">{r.job.jobNo}</Link></td>
                      <td className="td">{r.reg} <span className="text-ink-3 text-xs">{r.model}</span></td>
                      <td className="td">{COMMON_STAGE_LABELS[r.job.commonStage as CommonStage]}</td>
                      <td className="td text-crit">{formatDateTime(r.job.promisedAt ?? r.job.expectedCompletionAt)}</td>
                      <td className="td text-sm">
                        {r.job.blocker !== "none" && <Chip tone="warn">{r.job.blocker.replace("_", " ")}</Chip>} <span className="text-ink-2">{r.job.delayReason ?? ""}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <p className="text-xs text-ink-3">
          Service turnaround {formatHours(m.service.avgTurnaroundHours)} · comeback rate {formatPct(m.service.comebackPct)} (recorded on job cards). Customer complaints are not captured yet.
        </p>
      </div>
    </>
  );
}
