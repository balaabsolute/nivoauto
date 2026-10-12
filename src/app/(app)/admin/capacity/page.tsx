import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listMasterData, listCapacity } from "@/server/services/admin";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AdminTabs } from "../AdminTabs";
import { saveCapacityAction } from "../actions";

export const metadata = { title: "Capacity" };
const TYPES = [{ k: "service_bay", l: "Service bays", body: false }, { k: "body_bay", l: "Body bays", body: true }, { k: "paint_booth", l: "Paint booths", body: true }] as const;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default async function CapacityPage() {
  await requireCap("admin.master_data");
  const db = await getDb();
  const [md, caps] = await Promise.all([listMasterData(db), listCapacity(db)]);
  return (
    <>
      <PageHeader title="Administration" subtitle="Capacity profiles drive utilisation. Use productive hours actually available after operating hours, maintenance and staffing, not the count of bays alone." />
      <AdminTabs current="/admin/capacity" />
      <div className="space-y-4">
        {md.dealerships.filter((d) => d.active).map((d) => (
          <Panel key={d.id} title={d.name}>
            <div className="grid gap-4 md:grid-cols-3">
              {TYPES.filter((t) => !t.body || d.hasBodyShop).map((t) => {
                const c = caps.find((x) => x.dealershipId === d.id && x.resourceType === t.k);
                return (
                  <ActionForm key={t.k} action={saveCapacityAction} className="rounded border border-line p-3 space-y-2">
                    <input type="hidden" name="dealershipId" value={d.id} />
                    <input type="hidden" name="resourceType" value={t.k} />
                    <p className="font-medium text-sm">{t.l}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label><span className="label">Units</span><input name="physicalUnits" inputMode="numeric" defaultValue={c?.physicalUnits ?? ""} className="field" /></label>
                      <label><span className="label">Productive h/unit/day</span><input name="hours" inputMode="decimal" defaultValue={c?.productiveHoursPerUnitPerDay ?? ""} className="field" /></label>
                    </div>
                    <fieldset className="flex flex-wrap gap-2 text-xs"><legend className="label">Working days</legend>
                      {DAYS.map((day, i) => <label key={day} className="flex items-center gap-1"><input type="checkbox" name={day} defaultChecked={(c?.workingDays ?? "1111110")[i] === "1"} />{day[0].toUpperCase() + day.slice(1)}</label>)}
                    </fieldset>
                    {c && <p className="text-xs text-ink-3">= {(c.physicalUnits * c.productiveHoursPerUnitPerDay).toFixed(1)} productive hours per working day</p>}
                    <Submit className="btn-secondary btn-sm">Save</Submit>
                  </ActionForm>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
