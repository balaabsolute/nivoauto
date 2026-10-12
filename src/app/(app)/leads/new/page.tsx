import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { salesDealerships, catalogueForDealership } from "@/server/services/crm";
import { TIMEFRAME_LABELS, BUDGET_LABELS } from "@/domain/crm";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, EmptyState } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createLeadAction } from "../actions";

export const metadata = { title: "New enquiry" };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("leads.manage");
  const db = await getDb();
  const dealers = await salesDealerships(db, actor);
  const dealerId = first((await searchParams).dealer) ?? dealers[0]?.id;
  const models = dealerId ? await catalogueForDealership(db, dealerId) : [];
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/leads", label: "Enquiries" }} title="New enquiry" subtitle="Phone, web or referral enquiries. Showroom walk-ins come from the kiosk or the front desk." />
      {dealers.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4 text-[13px]">{dealers.map((d) => <Link key={d.id} href={`/leads/new?dealer=${d.id}`} className={`chip ${dealerId === d.id ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>{d.name}</Link>)}</div>
      )}
      {!dealerId ? <Panel><EmptyState title="No sales dealership in your scope" /></Panel> : (
        <ActionForm action={createLeadAction} className="space-y-4">
          <input type="hidden" name="dealershipId" value={dealerId} />
          <Panel title="Customer">
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="label">Name *</span><input name="name" required className="field" /></label>
              <label><span className="label">Mobile *</span><input name="phone" required inputMode="numeric" className="field" /></label>
              <label><span className="label">Email</span><input name="email" type="email" className="field" /></label>
              <label><span className="label">Source</span><select name="source" className="field"><option value="phone">Phone</option><option value="web">Website</option><option value="referral">Referral</option><option value="other">Other</option></select></label>
            </div>
            <div className="mt-3 space-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="consentUpdates" defaultChecked /> Customer agrees to updates about this enquiry (WhatsApp/SMS)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="consentMarketing" /> Customer agrees to offers and news about the chosen models</label>
            </div>
          </Panel>
          <Panel title="Interest">
            <fieldset><legend className="label">Models *</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-sm">{models.map((m) => <label key={m.id} className="flex items-center gap-1.5"><input type="checkbox" name="modelIds" value={m.id} />{m.name}</label>)}</div>
              {!models.length && <p className="text-sm text-warn">No models in the catalogue yet. An administrator adds them under Administration → Car models.</p>}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2 mt-3">
              <label><span className="label">Timeframe</span><select name="timeframe" className="field"><option value="">—</option>{Object.entries(TIMEFRAME_LABELS).filter(([k]) => k !== "not_planning").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label><span className="label">Budget</span><select name="budgetBand" className="field"><option value="">—</option>{Object.entries(BUDGET_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            </div>
            <label className="block mt-3"><span className="label">Notes</span><textarea name="notes" rows={2} className="field" /></label>
          </Panel>
          <Submit pendingText="Saving…">Create enquiry</Submit>
        </ActionForm>
      )}
    </div>
  );
}
