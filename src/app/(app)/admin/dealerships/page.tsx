import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listMasterData } from "@/server/services/admin";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Chip } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AdminTabs } from "../AdminTabs";
import { saveEntityAction, saveBrandAction, saveDealershipAction } from "../actions";

export const metadata = { title: "Entities & dealerships" };

export default async function AdminDealerships({ searchParams }: { searchParams: Promise<SP> }) {
  await requireCap("admin.master_data");
  const editId = first((await searchParams).edit);
  const md = await listMasterData(await getDb());
  const e = md.dealerships.find((d) => d.id === editId);
  return (
    <>
      <PageHeader title="Administration" subtitle="Master data. Dealerships are configuration, never hard-coded." />
      <AdminTabs current="/admin/dealerships" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Dealerships" bodyClassName="px-0 pb-0">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[700px]">
            <thead className="border-b border-line"><tr><th className="th">Code</th><th className="th">Dealership</th><th className="th">Brand / legal entity</th><th className="th">Facilities</th><th className="th" /></tr></thead>
            <tbody>{md.dealerships.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-0">
                <td className="td font-mono text-xs">{d.code}</td>
                <td className="td"><div className="font-medium">{d.name}</div><div className="text-xs text-ink-3">{d.locationName}{d.city ? `, ${d.city}` : ""}</div></td>
                <td className="td text-xs">{md.brands.find((b) => b.id === d.brandId)?.name} · {md.legalEntities.find((l) => l.id === d.legalEntityId)?.name}</td>
                <td className="td"><span className="flex flex-wrap gap-1">{d.hasSales && <Chip>Sales</Chip>}{d.hasService && <Chip>Service</Chip>}{d.hasBodyShop && <Chip>Body shop</Chip>}{!d.active && <Chip tone="crit">Inactive</Chip>}{d.isDemo && <Chip tone="warn">Demo</Chip>}</span></td>
                <td className="td"><Link href={`/admin/dealerships?edit=${d.id}`} className="text-petrol hover:underline">Edit</Link></td>
              </tr>))}</tbody>
          </table></div>
        </Panel>
        <Panel title={e ? `Edit ${e.name}` : "Add a dealership"} actions={e ? <Link href="/admin/dealerships" className="btn-ghost btn-sm">New</Link> : undefined}>
          <ActionForm action={saveDealershipAction} className="space-y-3" key={e?.id ?? "new"}>
            {e && <input type="hidden" name="id" value={e.id} />}
            <div className="grid grid-cols-3 gap-2">
              <label><span className="label">Code</span><input name="code" defaultValue={e?.code} required maxLength={8} className="field uppercase" /></label>
              <label className="col-span-2"><span className="label">Name</span><input name="name" defaultValue={e?.name} required className="field" /></label>
            </div>
            <label className="block"><span className="label">Brand</span><select name="brandId" defaultValue={e?.brandId} className="field">{md.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="block"><span className="label">Legal entity</span><select name="legalEntityId" defaultValue={e?.legalEntityId} className="field">{md.legalEntities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-2">
              <label><span className="label">Location</span><input name="locationName" defaultValue={e?.locationName} required className="field" /></label>
              <label><span className="label">City</span><input name="city" defaultValue={e?.city ?? ""} className="field" /></label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-1.5"><input type="checkbox" name="hasSales" defaultChecked={e?.hasSales ?? true} /> Sales</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="hasService" defaultChecked={e?.hasService ?? true} /> Service</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="hasBodyShop" defaultChecked={e?.hasBodyShop ?? false} /> Body shop</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={e?.active ?? true} /> Active</label>
            </div>
            <Submit>{e ? "Save dealership" : "Add dealership"}</Submit>
          </ActionForm>
        </Panel>
        <Panel title="Legal entities">
          <ul className="text-sm space-y-1 mb-3">{md.legalEntities.map((l) => <li key={l.id}><span className="font-mono text-xs text-ink-3">{l.code}</span> {l.name}{l.registrationRef && <span className="text-xs text-ink-3"> · {l.registrationRef}</span>}</li>)}</ul>
          <ActionForm action={saveEntityAction} resetOnSuccess className="grid grid-cols-3 gap-2 border-t border-line pt-3">
            <input name="code" placeholder="Code" required className="field" aria-label="Entity code" />
            <input name="name" placeholder="Registered name" required className="field col-span-2" aria-label="Entity name" />
            <input name="registrationRef" placeholder="CIN / GSTIN (optional)" className="field col-span-2" aria-label="Registration reference" />
            <Submit className="btn-secondary">Add</Submit>
          </ActionForm>
        </Panel>
        <Panel title="Brands">
          <p className="text-sm mb-3">{md.brands.map((b) => b.name).join(", ")}</p>
          <ActionForm action={saveBrandAction} resetOnSuccess className="flex gap-2 border-t border-line pt-3">
            <input name="name" placeholder="Brand name" required className="field" aria-label="Brand name" />
            <Submit className="btn-secondary">Add</Submit>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
