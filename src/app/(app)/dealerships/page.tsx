import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { buildDashboard } from "@/server/analytics";
import { periodFromParams, periodQuery, type SP } from "@/server/period-params";
import { businessDate, periodRangeLabel } from "@/domain/periods";
import { can } from "@/domain/permissions";
import { PageHeader, Panel, EmptyState } from "@/components/ui";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { DealerTable } from "@/components/dashboard/DealerTable";
import { toTableRows } from "@/components/dashboard/sections";

export const metadata = { title: "Dealerships" };

export default async function DealershipsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("dealership.dashboard");
  const sp = await searchParams;
  const { period } = periodFromParams(sp);
  const d = await buildDashboard(await getDb(), actor, period, { syncAlerts: false });
  if (d.dealers.length === 1 && actor.role === "dealership_manager") redirect(`/dealerships/${d.dealers[0].dealer.id}?${periodQuery(period)}`);
  return (
    <>
      <PageHeader title="Dealerships" subtitle={`${period.label}: ${periodRangeLabel(period)}`} actions={<PeriodSelector current={period.key} start={period.start} end={period.end} today={businessDate()} />} />
      <Panel>
        {d.dealers.length ? (
          <DealerTable rows={toTableRows(d.dealers)} query={periodQuery(period)} showFinancials={can(actor, "financials.view")} />
        ) : (
          <EmptyState title="No dealerships in your access scope">Ask your administrator to assign you to a dealership.</EmptyState>
        )}
      </Panel>
    </>
  );
}
