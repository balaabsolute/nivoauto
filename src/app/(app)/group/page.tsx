import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { buildDashboard } from "@/server/analytics";
import { periodFromParams, periodQuery, type SP } from "@/server/period-params";
import { businessDate, periodRangeLabel } from "@/domain/periods";
import { formatDateTime } from "@/domain/format";
import { PageHeader, Panel, Notice, EmptyState } from "@/components/ui";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { DealerTable } from "@/components/dashboard/DealerTable";
import {
  HeadlineFigures, RevenueMixPanel, PipelinePanel, OperationalHealthPanel, StageQueue, InsightsPanel, FreshnessStrip, toTableRows, BODYSHOP_COMMON_STAGES,
} from "@/components/dashboard/sections";

export const metadata = { title: "Group overview" };

export default async function GroupPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("group.dashboard");
  const sp = await searchParams;
  const { period, error } = periodFromParams(sp);
  const d = await buildDashboard(await getDb(), actor, period, { requires: "group.dashboard" });
  const q = periodQuery(period);
  const includesToday = period.end === businessDate();

  return (
    <>
      <PageHeader
        title="Group overview"
        subtitle={
          <>
            {period.label}: {periodRangeLabel(period)}{includesToday && " (today in progress)"} · compared with {d.period.comparison.label}
            <span className="block text-xs text-ink-3 mt-0.5">Calculated {formatDateTime(d.generatedAt)} from stored records</span>
          </>
        }
        actions={<PeriodSelector current={period.key} start={period.start} end={period.end} today={businessDate()} />}
      />
      {error && <div className="mb-4"><Notice tone="warn" title="Showing month to date instead">{error}</Notice></div>}

      {d.dealers.length === 0 ? (
        <Panel><EmptyState title="No dealerships set up yet" icon="building">An administrator adds legal entities, brands and dealerships under Administration. The dashboard fills in as jobs and transactions are recorded.</EmptyState></Panel>
      ) : (
        <div className="space-y-4">
          <FreshnessStrip d={d} scopeLabel="dealerships" />
          <HeadlineFigures m={d.total} showFinancials jobsHref="/jobs" />

          <div className="grid gap-4 xl:grid-cols-3">
            <Panel
              className="xl:col-span-2"
              title="Revenue trend"
              subtitle={d.trendPeriod.key !== period.key ? `Showing month to date for context (${periodRangeLabel(d.trendPeriod)})` : `${period.granularity === "day" ? "Daily" : "Monthly"}, cumulative`}
            >
              {d.trend.every((p) => !p.current) ? <EmptyState title="No revenue recorded in this window" /> : <TrendChart data={d.trend} comparisonLabel={d.trendPeriod.comparison.label} granularity={d.trendPeriod.granularity} />}
            </Panel>
            <RevenueMixPanel m={d.total} />
          </div>

          <Panel title="Dealership comparison" subtitle="Select a dealership to drill down. Sort any column.">
            <DealerTable rows={toTableRows(d.dealers)} query={q} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <InsightsPanel alerts={d.alerts} />
            <OperationalHealthPanel m={d.total} />
            <div className="space-y-4">
              <PipelinePanel m={d.total} />
              <StageQueue wip={d.total.bodyshopWip} stages={BODYSHOP_COMMON_STAGES} title="Body shop stage queue" subtitle="Vehicles in each stage now" href="/bodyshop" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
