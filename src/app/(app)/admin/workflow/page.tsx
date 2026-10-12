import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listMasterData, listStageConfig } from "@/server/services/admin";
import { commonStagesFor, COMMON_STAGE_LABELS } from "@/domain/workflow";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Notice } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AdminTabs } from "../AdminTabs";
import { saveStagesAction } from "../actions";
import type { JobType } from "@/db/schema";

export const metadata = { title: "Workflow stages" };

export default async function WorkflowPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireCap("admin.workflow");
  const sp = await searchParams;
  const jobType: JobType = first(sp.type) === "bodyshop" ? "bodyshop" : "service";
  const dealer = first(sp.dealer) || null;
  const db = await getDb();
  const md = await listMasterData(db);
  const own = await listStageConfig(db, dealer, jobType);
  const group = await listStageConfig(db, null, jobType);
  const usingDefault = !!dealer && !own.length;
  const rows = (usingDefault ? group : own).map((s) => ({ code: s.code, label: s.label, commonStage: s.commonStage, sequence: s.sequence }));
  const blanks = 3;
  const commons = commonStagesFor(jobType);
  const q = (p: Record<string, string | null>) => `/admin/workflow?${new URLSearchParams(Object.entries({ type: jobType, dealer, ...p }).filter(([, v]) => v) as [string, string][]).toString()}`;

  return (
    <>
      <PageHeader title="Administration" subtitle="Locations can rename, add or split stages. Each stage maps to a common reporting stage so group figures stay comparable." />
      <AdminTabs current="/admin/workflow" />
      <div className="flex flex-wrap gap-2 mb-4 text-[13px]">
        <Link href={q({ type: "service" })} className={`chip ${jobType === "service" ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>Service</Link>
        <Link href={q({ type: "bodyshop" })} className={`chip ${jobType === "bodyshop" ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>Body shop</Link>
        <span className="w-px bg-line mx-1" />
        <Link href={q({ dealer: null })} className={`chip ${!dealer ? "bg-petrol text-white" : "bg-panel border border-line text-ink-2"}`}>Group default</Link>
        {md.dealerships.filter((d) => (jobType === "bodyshop" ? d.hasBodyShop : d.hasService)).map((d) => <Link key={d.id} href={q({ dealer: d.id })} className={`chip ${dealer === d.id ? "bg-petrol text-white" : "bg-panel border border-line text-ink-2"}`}>{d.name}</Link>)}
      </div>
      {usingDefault && <div className="mb-4"><Notice>This location uses the group default. Saving below creates a location-specific workflow.</Notice></div>}
      <Panel title={`${dealer ? md.dealerships.find((d) => d.id === dealer)?.name : "Group default"}: ${jobType === "service" ? "service" : "body shop"} stages`}>
        <ActionForm action={saveStagesAction} className="space-y-3">
          <input type="hidden" name="jobType" value={jobType} />
          {dealer && <input type="hidden" name="dealershipId" value={dealer} />}
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[620px]">
            <thead><tr><th className="th w-24">Order</th><th className="th">Stage code</th><th className="th">Label shown to staff</th><th className="th">Reports as (common stage)</th></tr></thead>
            <tbody>
              {[...rows, ...Array.from({ length: blanks }, () => null)].map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="td"><input name="sequence" defaultValue={r?.sequence ?? (rows.length + i + 1) * 10} inputMode="numeric" className="field h-8" aria-label="Order" /></td>
                  <td className="td"><input name="code" defaultValue={r?.code ?? ""} className="field h-8 font-mono text-xs" aria-label="Stage code" placeholder={r ? undefined : "new_stage"} /></td>
                  <td className="td"><input name="label" defaultValue={r?.label ?? ""} className="field h-8" aria-label="Label" /></td>
                  <td className="td"><select name="commonStage" defaultValue={r?.commonStage ?? commons[0]} className="field h-8" aria-label="Common stage">{commons.map((c) => <option key={c} value={c}>{COMMON_STAGE_LABELS[c]}</option>)}</select></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="text-xs text-ink-3">Rules: stages run in order; the first maps to {COMMON_STAGE_LABELS[commons[0]]} and the last to Delivered; every common stage needs at least one stage. Clear a row’s code to remove it. Open jobs must still find their current stage.</p>
          <div className="flex gap-2">
            <Submit name="intent" value="save">Save workflow</Submit>
            {dealer && !usingDefault && <Submit name="intent" value="reset" className="btn-secondary">Reset to group default</Submit>}
          </div>
        </ActionForm>
      </Panel>
    </>
  );
}
