import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { loadDealers } from "@/server/analytics";
import { dealershipScope } from "@/domain/permissions";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, EmptyState } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createJobAction } from "../actions";

export const metadata = { title: "New job card" };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("jobs.create");
  const sp = await searchParams;
  const type = first(sp.type) === "bodyshop" ? "bodyshop" : "service";
  const dealers = (await loadDealers(await getDb(), dealershipScope(actor))).filter((d) => (type === "bodyshop" ? d.hasBodyShop : d.hasService));
  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: type === "bodyshop" ? "/bodyshop" : "/jobs", label: "Back" }}
        title={type === "bodyshop" ? "New body shop job" : "New service job card"}
        subtitle="For a walk-in. Appointment customers are checked in from Appointments."
        actions={<Link href={`/jobs/new?type=${type === "bodyshop" ? "service" : "bodyshop"}`} className="btn-ghost">Switch to {type === "bodyshop" ? "service" : "body shop"}</Link>}
      />
      {!dealers.length ? (
        <Panel><EmptyState title={`No ${type === "bodyshop" ? "body shop" : "service"} location in your scope`}>Ask your administrator to assign you to a dealership with this facility.</EmptyState></Panel>
      ) : (
        <ActionForm action={createJobAction} className="space-y-4">
          <input type="hidden" name="jobType" value={type} />
          <Panel title="Vehicle">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="label">Dealership</span>
                <select name="dealershipId" className="field" defaultValue={dealers[0].id} required>
                  {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label><span className="label">Registration number *</span><input name="registrationNo" required autoCapitalize="characters" placeholder="e.g. TN 01 AB 1234" className="field uppercase" /></label>
              <label><span className="label">Odometer (km)</span><input name="odometerKm" inputMode="numeric" className="field" /></label>
              <label><span className="label">Make</span><input name="make" className="field" /></label>
              <label><span className="label">Model</span><input name="model" className="field" /></label>
            </div>
            <p className="text-xs text-ink-3 mt-2">If the vehicle has visited before, its existing customer record is reused automatically.</p>
          </Panel>
          <Panel title="Customer">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="label">Name *</span><input name="customerName" required autoComplete="off" className="field" /></label>
              <label><span className="label">Mobile</span><input name="phone" type="tel" inputMode="tel" placeholder="10-digit mobile" className="field" /></label>
              <label><span className="label">Email</span><input name="email" type="email" className="field" /></label>
            </div>
            <fieldset className="mt-3">
              <legend className="label">Customer agreed to receive status updates by</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="consentWhatsapp" className="h-4 w-4" /> WhatsApp</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="consentSms" className="h-4 w-4" /> SMS</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="consentEmail" className="h-4 w-4" /> Email</label>
              </div>
              <label className="block mt-2 max-w-xs"><span className="label">Preferred channel</span>
                <select name="preferredChannel" className="field" defaultValue="">
                  <option value="">No preference</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option>
                </select>
              </label>
              <p className="text-xs text-ink-3 mt-1">Consent is recorded with a timestamp. Without it, no messages are sent.</p>
            </fieldset>
          </Panel>
          <Panel title="Work">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="label">{type === "bodyshop" ? "Damage description *" : "Customer complaint / requested work *"}</span><textarea name="complaint" rows={3} required className="field" /></label>
              <label><span className="label">Promised delivery</span><input type="datetime-local" name="promisedAt" className="field" /></label>
              <label><span className="label">Initial estimate (₹, ex-tax)</span><input name="estimateAmount" inputMode="decimal" className="field" /></label>
              {type === "bodyshop" && (
                <>
                  <label><span className="label">Insurer (if claim)</span><input name="insurerName" className="field" /></label>
                  <label><span className="label">Claim reference</span><input name="claimRef" className="field" /></label>
                </>
              )}
            </div>
          </Panel>
          <div className="flex gap-2"><Submit pendingText="Creating…">Create job card</Submit><Link href="/jobs" className="btn-secondary">Cancel</Link></div>
        </ActionForm>
      )}
    </div>
  );
}
