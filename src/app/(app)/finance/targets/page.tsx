import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listTargets } from "@/server/services/finance";
import { loadDealers } from "@/server/analytics";
import { can, dealershipScope } from "@/domain/permissions";
import { businessDate } from "@/domain/periods";
import { formatInrCompact, formatDateTime } from "@/domain/format";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Chip } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { targetAction } from "../actions";

export const metadata = { title: "Targets" };

export default async function TargetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("financials.view");
  const m = first((await searchParams).month);
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : businessDate().slice(0, 7);
  const db = await getDb();
  const [dealers, tgts] = await Promise.all([loadDealers(db, dealershipScope(actor)), listTargets(db, actor, [month])]);
  const edit = can(actor, "targets.manage");
  return (
    <>
      <PageHeader back={{ href: "/finance", label: "Finance" }} title="Targets" subtitle="Only approved targets are used for target achievement. Targets are set by the group, not inferred."
        actions={<form action="/finance/targets" className="flex gap-2"><input type="month" name="month" defaultValue={month} className="field h-8 w-auto" aria-label="Month" /><button className="btn-secondary btn-sm">Go</button></form>} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {dealers.map((d) => {
          const t = tgts.find((x) => x.dealershipId === d.id);
          return (
            <Panel key={d.id} title={d.name} subtitle={month} actions={<Chip tone={t?.approvedAt ? "good" : t ? "warn" : "neutral"}>{t?.approvedAt ? "Approved" : t ? "Draft" : "Not set"}</Chip>}>
              {edit ? (
                <ActionForm action={targetAction} className="space-y-2">
                  <input type="hidden" name="dealershipId" value={d.id} />
                  <input type="hidden" name="month" value={month} />
                  <label className="block"><span className="label">Revenue target (₹, ex-tax)</span><input name="revenueTarget" inputMode="decimal" defaultValue={t?.revenueTarget ?? ""} className="field" /></label>
                  <label className="block"><span className="label">Vehicle deliveries target</span><input name="deliveriesTarget" inputMode="numeric" defaultValue={t?.deliveriesTarget ?? ""} className="field" /></label>
                  <div className="flex gap-2"><Submit name="intent" value="approve">Save & approve</Submit><Submit name="intent" value="draft" className="btn-secondary">Save draft</Submit></div>
                  {t?.approvedAt && <p className="text-xs text-ink-3">Approved {formatDateTime(t.approvedAt)}</p>}
                </ActionForm>
              ) : (
                <p className="text-sm">{t ? <>Revenue {formatInrCompact(t.revenueTarget)} · Deliveries {t.deliveriesTarget ?? "—"}</> : "No target set"}</p>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
