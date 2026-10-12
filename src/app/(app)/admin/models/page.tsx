import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { allCarModels } from "@/server/services/crm";
import { listMasterData } from "@/server/services/admin";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Chip, EmptyState } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { bodyLabel } from "@/domain/crm";
import { AdminTabs } from "../AdminTabs";
import { saveModelAction } from "../../leads/actions";

export const metadata = { title: "Car models" };
const BODY_TYPES = ["hatchback", "sedan", "suv", "mpv", "luxury", "ev"];

export default async function AdminModels({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("catalogue.manage");
  const editId = first((await searchParams).edit);
  const db = await getDb();
  const [rows, md] = await Promise.all([allCarModels(db, actor), listMasterData(db)]);
  const e = rows.find((r) => r.m.id === editId)?.m;
  const brands = [...new Set(rows.map((r) => r.brand))];
  return (
    <>
      <PageHeader title="Administration" subtitle="Car models shown on the showroom and lounge kiosks, and used for enquiries and model updates." />
      <AdminTabs current="/admin/models" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title={`Models (${rows.length})`} bodyClassName="px-0 pb-0">
          {!rows.length ? <EmptyState title="No models yet" icon="car">Add the models each brand sells. Kiosks show only active models of the dealership’s brand.</EmptyState> : (
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
              <thead className="border-b border-line"><tr><th className="th">Brand</th><th className="th">Model</th><th className="th">Body / fuel</th><th className="th">Price band</th><th className="th">Order</th><th className="th" /></tr></thead>
              <tbody>
                {brands.flatMap((b) => rows.filter((r) => r.brand === b).map(({ m }) => (
                  <tr key={m.id} className="border-b border-line last:border-0">
                    <td className="td text-ink-2">{b}</td>
                    <td className="td font-medium">{m.name} <span className="inline-flex gap-1 ml-1">{!m.active && <Chip tone="neutral">Hidden</Chip>}{m.isDemo && <Chip tone="warn">Demo</Chip>}</span></td>
                    <td className="td text-ink-2">{[m.bodyType ? bodyLabel(m.bodyType) : null, m.fuelTypes].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="td text-ink-2">{m.priceBand ?? "—"}</td>
                    <td className="td num">{m.sortOrder}</td>
                    <td className="td"><Link href={`/admin/models?edit=${m.id}`} className="text-petrol hover:underline">Edit</Link></td>
                  </tr>
                )))}
              </tbody>
            </table></div>
          )}
        </Panel>
        <Panel title={e ? `Edit ${e.name}` : "Add a model"} actions={e ? <Link href="/admin/models" className="btn-ghost btn-sm">New</Link> : undefined}>
          <ActionForm action={saveModelAction} resetOnSuccess={!e} className="space-y-3" key={e?.id ?? "new"}>
            {e && <input type="hidden" name="id" value={e.id} />}
            <label className="block"><span className="label">Brand</span><select name="brandId" defaultValue={e?.brandId} className="field">{md.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="block"><span className="label">Model name</span><input name="name" defaultValue={e?.name} required className="field" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label><span className="label">Body type</span><select name="bodyType" defaultValue={e?.bodyType ?? ""} className="field"><option value="">—</option>{BODY_TYPES.map((t) => <option key={t} value={t}>{bodyLabel(t)}</option>)}</select></label>
              <label><span className="label">Fuel types</span><input name="fuelTypes" defaultValue={e?.fuelTypes ?? ""} placeholder="petrol,diesel" className="field" /></label>
              <label><span className="label">Price band (display)</span><input name="priceBand" defaultValue={e?.priceBand ?? ""} placeholder="As published by the brand" className="field" /></label>
              <label><span className="label">Sort order</span><input name="sortOrder" type="number" defaultValue={e?.sortOrder ?? 0} className="field" /></label>
            </div>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={e?.active ?? true} /> Show on kiosks and enquiry forms</label>
            <Submit>{e ? "Save model" : "Add model"}</Submit>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
