import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { getLead } from "@/server/services/crm";
import { NotFoundError } from "@/server/errors";
import { can, ForbiddenError } from "@/domain/permissions";
import { STAGE_LABELS, STATUS_LABELS, TIMEFRAME_LABELS, NURTURE_SKIP_LABELS } from "@/domain/crm";
import { EVENT_LABELS } from "@/domain/notifications";
import { formatDateTime, formatInr, relativeTime, toLocalInput } from "@/domain/format";
import { LEAD_STAGES, TIMEFRAMES } from "@/db/schema";
import { PageHeader, Panel, Chip, KeyValue, Notice } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import {
  updateLeadAction, assignLeadAction, interestsAction, logContactAction, testDriveAction, completeTestDriveAction, cancelTestDriveAction,
  addFollowUpAction, completeFollowUpAction, closeLeadAction, reopenLeadAction,
} from "../actions";

export const metadata = { title: "Enquiry" };

const DRIVE_TONE = { requested: "warn", scheduled: "info", completed: "good", cancelled: "neutral" } as const;
const NOTIF_TONE = { sent: "good", failed: "crit", skipped: "neutral", queued: "info" } as const;
const ACT_LABEL: Record<string, string> = {
  created: "Created", note: "Note", call: "Call", visit: "Visit", message: "Message", test_drive: "Test drive", stage_change: "Stage",
  nurture: "Nurture", follow_up: "Follow-up", outcome: "Outcome", assignment: "Assigned",
};

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireCap("leads.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getLead>>;
  try {
    d = await getLead(await getDb(), actor, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  const { lead: l, customer: c } = d;
  const open = l.status === "open";
  const manage = can(actor, "leads.manage");
  const canAssign = can(actor, "leads.assign");
  const mine = l.consultantId === actor.id;
  const consultantName = d.consultants.find((x) => x.id === l.consultantId)?.name;
  const now = new Date();
  const openFus = d.followUps.filter((x) => x.f.status === "open");
  const doneFus = d.followUps.filter((x) => x.f.status !== "open");
  const interestIds = new Set(d.interests.map((x) => x.m.id));
  const hid = <input type="hidden" name="leadId" value={l.id} />;
  const testDriveModels = d.interests.length ? d.interests.map((x) => x.m) : d.catalogue;

  return (
    <>
      <PageHeader
        back={{ href: "/leads", label: "Enquiries" }}
        title={<span className="flex flex-wrap items-center gap-2">{c.name}<span className="text-base font-normal text-ink-3">{l.leadNo}</span></span>}
        subtitle={`${d.dealership.name} · ${d.brand} · ${l.source.replace("_", " ")} · created ${relativeTime(l.createdAt, now)}`}
        actions={open ? <Chip tone="petrol">{STAGE_LABELS[l.stage]}</Chip> : <Chip tone={l.status === "won" ? "good" : "neutral"}>{STATUS_LABELS[l.status]}</Chip>}
      />

      {!open && (
        <div className="mb-4">
          <Notice tone={l.status === "won" ? "good" : "info"} title={`${STATUS_LABELS[l.status]}${l.closedAt ? ` · ${formatDateTime(l.closedAt)}` : ""}`}>
            {l.status === "lost_other_dealer" && <>Bought {[l.lostToBrand, l.lostToModel].filter(Boolean).join(" ")}{l.lostToDealer ? ` at ${l.lostToDealer}` : ""}. </>}
            {l.closeReason && <>{l.closeReason}. </>}
            {l.wonInvoiceRef && <>Invoice {l.wonInvoiceRef}. </>}
            No further follow-ups or model updates will be sent for this enquiry.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4">
          {/* Interest */}
          <Panel title="Cars of interest" subtitle="Model updates go to open enquiries for these models">
            <div className="flex flex-wrap gap-2 mb-3">
              {d.interests.length ? d.interests.map((x) => <Chip key={x.m.id} tone={x.i.isPrimary ? "petrol" : "neutral"}>{x.m.name}{x.i.isPrimary ? " · primary" : ""}</Chip>) : <span className="text-sm text-ink-3">None recorded</span>}
            </div>
            {open && manage && d.catalogue.length > 0 && (
              <details>
                <summary className="text-sm text-petrol cursor-pointer">Change models</summary>
                <ActionForm action={interestsAction} className="mt-2">
                  {hid}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-sm">
                    {d.catalogue.map((m) => <label key={m.id} className="flex items-center gap-1.5"><input type="checkbox" name="modelIds" value={m.id} defaultChecked={interestIds.has(m.id)} />{m.name}</label>)}
                  </div>
                  <div className="mt-2"><Submit className="btn-secondary btn-sm">Save models</Submit></div>
                </ActionForm>
              </details>
            )}
          </Panel>

          {/* Details */}
          <Panel title="Enquiry details">
            {open && manage ? (
              <ActionForm action={updateLeadAction} className="space-y-3">
                {hid}
                <div className="grid gap-3 sm:grid-cols-3">
                  <label><span className="label">Stage</span><select name="stage" defaultValue={l.stage} className="field">{LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select></label>
                  <label><span className="label">Timeframe</span><select name="timeframe" defaultValue={l.timeframe ?? ""} className="field"><option value="">—</option>{TIMEFRAMES.filter((t) => t !== "not_planning").map((t) => <option key={t} value={t}>{TIMEFRAME_LABELS[t]}</option>)}</select></label>
                  <label><span className="label">Next follow-up</span><input type="datetime-local" name="nextFollowUpAt" defaultValue={toLocalInput(l.nextFollowUpAt)} className="field" /></label>
                  <label><span className="label">Budget from (₹)</span><input name="budgetMin" inputMode="numeric" defaultValue={l.budgetMin ?? ""} className="field" /></label>
                  <label><span className="label">Budget up to (₹)</span><input name="budgetMax" inputMode="numeric" defaultValue={l.budgetMax ?? ""} className="field" /></label>
                  <label><span className="label">Fuel preference</span><input name="fuelPreference" defaultValue={l.fuelPreference ?? ""} className="field" /></label>
                  <label><span className="label">Finance needed?</span><select name="financeNeeded" defaultValue={l.financeNeeded == null ? "" : l.financeNeeded ? "yes" : "no"} className="field"><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                  <label className="sm:col-span-2"><span className="label">Exchange vehicle</span><input name="exchangeVehicle" defaultValue={l.exchangeVehicle ?? ""} placeholder="Make, model, year" className="field" /></label>
                </div>
                <Submit className="btn-secondary">Save details</Submit>
              </ActionForm>
            ) : (
              <dl className="grid gap-3 sm:grid-cols-3">
                <KeyValue label="Stage">{STAGE_LABELS[l.stage]}</KeyValue>
                <KeyValue label="Timeframe">{l.timeframe ? TIMEFRAME_LABELS[l.timeframe] : "—"}</KeyValue>
                <KeyValue label="Budget">{l.budgetMin || l.budgetMax ? `${formatInr(l.budgetMin)} – ${formatInr(l.budgetMax)}` : "—"}</KeyValue>
                <KeyValue label="Fuel">{l.fuelPreference ?? "—"}</KeyValue>
                <KeyValue label="Finance">{l.financeNeeded == null ? "—" : l.financeNeeded ? "Yes" : "No"}</KeyValue>
                <KeyValue label="Exchange">{l.exchangeVehicle ?? "—"}</KeyValue>
              </dl>
            )}
          </Panel>

          {/* Test drives */}
          <Panel title="Test drives">
            {!d.drives.length && <p className="text-sm text-ink-3 mb-3">No test drives yet.</p>}
            <ul className="divide-y divide-line">
              {d.drives.map(({ t, model, consultant }) => (
                <li key={t.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{model}</span>
                    <Chip tone={DRIVE_TONE[t.status]}>{t.status}</Chip>
                    <span className="text-sm text-ink-2">
                      {t.completedAt ? `Driven ${formatDateTime(t.completedAt)}` : t.scheduledAt ? `Scheduled ${formatDateTime(t.scheduledAt)}` : "Not scheduled"}
                      {consultant ? ` · ${consultant}` : ""}{t.rating ? ` · ${"★".repeat(t.rating)}` : ""}
                    </span>
                  </div>
                  {t.notes && <p className="text-sm text-ink-2 mt-1">{t.notes}</p>}
                  {open && manage && (t.status === "requested" || t.status === "scheduled") && (
                    <div className="mt-2 flex flex-wrap items-start gap-2">
                      <details className="flex-1 min-w-[260px]">
                        <summary className="btn-primary btn-sm inline-flex cursor-pointer list-none">Record as completed</summary>
                        <ActionForm action={completeTestDriveAction} className="mt-2 grid gap-2 sm:grid-cols-3 items-end">
                          <input type="hidden" name="id" value={t.id} />
                          <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="licenceChecked" required /> Driving licence checked *</label>
                          <label><span className="label">Customer impression</span><select name="rating" className="field"><option value="">—</option>{[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{"★".repeat(r)}</option>)}</select></label>
                          <label className="sm:col-span-2"><span className="label">Notes</span><input name="notes" className="field" /></label>
                          <Submit className="btn-primary btn-sm">Save</Submit>
                        </ActionForm>
                      </details>
                      <ActionForm action={cancelTestDriveAction}><input type="hidden" name="id" value={t.id} /><Submit className="btn-ghost btn-sm" pendingText="…">Cancel</Submit></ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {open && manage && testDriveModels.length > 0 && (
              <ActionForm action={testDriveAction} resetOnSuccess className="mt-3 grid gap-2 sm:grid-cols-3 items-end border-t border-line pt-3">
                {hid}
                <label><span className="label">Model</span><select name="modelId" className="field">{testDriveModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                <label><span className="label">When (optional)</span><input type="datetime-local" name="scheduledAt" className="field" /></label>
                <Submit className="btn-secondary">Book test drive</Submit>
              </ActionForm>
            )}
          </Panel>

          {/* Follow-ups */}
          <Panel title="Follow-ups" subtitle={open ? undefined : "Open follow-ups were cancelled when the enquiry closed"}>
            {!openFus.length && <p className="text-sm text-ink-3 mb-2">No open follow-ups.{open ? " Add one so the enquiry doesn’t go cold." : ""}</p>}
            <ul className="divide-y divide-line">
              {openFus.map(({ f, assignee }) => (
                <li key={f.id} className="py-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm"><span className="font-medium capitalize">{f.kind}</span>: {f.reason}</p>
                    <p className={clsx("text-xs", f.dueAt < now ? "text-crit font-medium" : "text-ink-3")}>Due {formatDateTime(f.dueAt)} · {assignee ?? "Unassigned"}</p>
                  </div>
                  {manage && (
                    <ActionForm action={completeFollowUpAction} className="flex flex-wrap items-center gap-1">
                      <input type="hidden" name="id" value={f.id} />
                      <input name="note" required placeholder="What happened?" className="field h-8 w-48 text-[13px]" aria-label="Outcome note" />
                      <Submit className="btn-secondary btn-sm" name="status" value="done">Done</Submit>
                      <Submit className="btn-ghost btn-sm" name="status" value="skipped">Skip</Submit>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
            {open && manage && (
              <ActionForm action={addFollowUpAction} resetOnSuccess className="mt-3 grid gap-2 sm:grid-cols-4 items-end border-t border-line pt-3">
                {hid}
                <label><span className="label">Due</span><input type="datetime-local" name="dueAt" required className="field" /></label>
                <label><span className="label">Type</span><select name="kind" className="field"><option value="call">Call</option><option value="message">Message</option><option value="visit">Visit</option></select></label>
                <label><span className="label">Reason</span><input name="reason" required className="field" /></label>
                <Submit className="btn-secondary">Add follow-up</Submit>
              </ActionForm>
            )}
            {doneFus.length > 0 && (
              <details className="mt-3">
                <summary className="text-sm text-petrol cursor-pointer">{doneFus.length} completed / skipped</summary>
                <ul className="mt-2 space-y-1 text-sm text-ink-2">
                  {doneFus.map(({ f }) => <li key={f.id}>{f.status === "done" ? "✓" : "–"} {f.reason}{f.outcomeNote ? ` — ${f.outcomeNote}` : ""} <span className="text-xs text-ink-3">({formatDateTime(f.completedAt)})</span></li>)}
                </ul>
              </details>
            )}
          </Panel>

          {/* Timeline */}
          <Panel title="Timeline">
            {open && manage && (
              <ActionForm action={logContactAction} resetOnSuccess className="mb-4 grid gap-2 sm:grid-cols-[140px_1fr_200px_auto] items-end">
                {hid}
                <label><span className="label">Log</span><select name="type" className="field"><option value="call">Call</option><option value="message">Message</option><option value="visit">Visit</option><option value="note">Note</option></select></label>
                <label><span className="label">What was discussed</span><input name="text" required className="field" /></label>
                <label><span className="label">Next follow-up</span><input type="datetime-local" name="nextFollowUpAt" className="field" /></label>
                <Submit className="btn-secondary">Log</Submit>
              </ActionForm>
            )}
            <ol className="space-y-3">
              {d.activities.map(({ a, userName }) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-petrol shrink-0" aria-hidden />
                  <div>
                    <p><span className="font-medium">{ACT_LABEL[a.type] ?? a.type}</span>{a.text ? ` — ${a.text}` : ""}</p>
                    <p className="text-xs text-ink-3">{formatDateTime(a.at)}{userName ? ` · ${userName}` : ""}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-4">
          {/* Customer */}
          <Panel title="Customer">
            <dl className="space-y-2">
              <KeyValue label="Name">{c.name}</KeyValue>
              <KeyValue label="Mobile">{c.contactHidden ? <span className="text-ink-3">Hidden for your role</span> : c.phone ? <a href={`tel:${c.phone}`} className="text-petrol">{c.phone}</a> : "—"}</KeyValue>
              {!c.contactHidden && c.email && <KeyValue label="Email">{c.email}</KeyValue>}
              <KeyValue label="Consent">
                <span className="flex flex-wrap gap-1">
                  <Chip tone={c.consent.whatsapp ? "good" : "neutral"}>WhatsApp {c.consent.whatsapp ? "✓" : "✗"}</Chip>
                  <Chip tone={c.consent.sms ? "good" : "neutral"}>SMS {c.consent.sms ? "✓" : "✗"}</Chip>
                  <Chip tone={c.consent.marketing && !c.consent.optedOutAt ? "good" : "neutral"}>Offers {c.consent.marketing && !c.consent.optedOutAt ? "✓" : "✗"}</Chip>
                </span>
              </KeyValue>
              <KeyValue label="Model updates">
                {c.nurture ? <span className="text-ink-2">Not sent — {NURTURE_SKIP_LABELS[c.nurture].toLowerCase()}</span> : <span className="text-good">Will receive updates on these models</span>}
              </KeyValue>
            </dl>
          </Panel>

          {/* Assignment */}
          <Panel title="Sales consultant">
            <p className="text-sm mb-2">{consultantName ?? <span className="text-warn">Unassigned</span>}</p>
            {open && canAssign && (
              <ActionForm action={assignLeadAction} className="flex gap-2">
                {hid}
                <select name="consultantId" defaultValue={l.consultantId ?? ""} className="field" aria-label="Consultant">
                  <option value="">Unassigned</option>
                  {d.consultants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <Submit className="btn-secondary">Assign</Submit>
              </ActionForm>
            )}
            {open && !canAssign && manage && !l.consultantId && (
              <ActionForm action={assignLeadAction}>{hid}<input type="hidden" name="consultantId" value={actor.id} /><Submit className="btn-primary btn-sm">Take this enquiry</Submit></ActionForm>
            )}
            {open && !canAssign && manage && l.consultantId && !mine && <p className="text-xs text-ink-3">Ask your manager to reassign.</p>}
          </Panel>

          {/* Outcome */}
          {open && manage && (
            <Panel title="Close enquiry" subtitle="Closing stops follow-ups and model updates">
              <div className="space-y-2">
                <details className="rounded-lg border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium text-good">Sold — car booked / invoiced</summary>
                  <ActionForm action={closeLeadAction} className="mt-2 space-y-2">
                    {hid}<input type="hidden" name="status" value="won" />
                    <label className="block"><span className="label">Booking / invoice ref (optional)</span><input name="wonInvoiceRef" className="field" /></label>
                    <label className="block"><span className="label">Note</span><input name="reason" className="field" /></label>
                    <Submit className="btn-primary btn-sm">Record sale</Submit>
                  </ActionForm>
                </details>
                <details className="rounded-lg border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">Bought elsewhere</summary>
                  <ActionForm action={closeLeadAction} className="mt-2 space-y-2">
                    {hid}<input type="hidden" name="status" value="lost_other_dealer" />
                    <div className="grid grid-cols-2 gap-2">
                      <label><span className="label">Brand *</span><input name="lostToBrand" required placeholder="or “Unknown”" className="field" /></label>
                      <label><span className="label">Model</span><input name="lostToModel" className="field" /></label>
                    </div>
                    <label className="block"><span className="label">Dealer / showroom</span><input name="lostToDealer" className="field" /></label>
                    <label className="block"><span className="label">Why (price, delivery, features…)</span><input name="reason" className="field" /></label>
                    <Submit className="btn-secondary btn-sm">Record</Submit>
                  </ActionForm>
                </details>
                <details className="rounded-lg border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">Not interested any more</summary>
                  <ActionForm action={closeLeadAction} className="mt-2 space-y-2">
                    {hid}<input type="hidden" name="status" value="not_interested" />
                    <label className="block"><span className="label">Reason the customer gave *</span><input name="reason" required className="field" /></label>
                    <Submit className="btn-secondary btn-sm">Record</Submit>
                  </ActionForm>
                </details>
                <details className="rounded-lg border border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium text-crit">Customer said: don’t contact me</summary>
                  <ActionForm action={closeLeadAction} className="mt-2 space-y-2">
                    {hid}<input type="hidden" name="status" value="opted_out" />
                    <p className="text-xs text-ink-2">Records a marketing opt-out on the customer. They won’t get offers or model updates from any enquiry. Service updates they agreed to are unaffected.</p>
                    <Submit className="btn-danger btn-sm">Record opt-out</Submit>
                  </ActionForm>
                </details>
              </div>
            </Panel>
          )}
          {!open && canAssign && l.status !== "opted_out" && (
            <Panel title="Reopen">
              <ActionForm action={reopenLeadAction} className="space-y-2">
                {hid}
                <label className="block"><span className="label">Reason</span><input name="reason" required className="field" /></label>
                <Submit className="btn-secondary btn-sm">Reopen enquiry</Submit>
              </ActionForm>
            </Panel>
          )}

          {/* Messages */}
          <Panel title="Messages to customer" bodyClassName="px-0 pb-1">
            {!d.notifications.length ? <p className="px-4 pb-3 text-sm text-ink-3">None yet.</p> : (
              <ul className="divide-y divide-line">
                {d.notifications.map((x) => (
                  <li key={x.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{EVENT_LABELS[x.event]}</span>
                      <Chip tone={NOTIF_TONE[x.status]}>{x.status}{x.channel ? ` · ${x.channel}` : ""}</Chip>
                    </div>
                    <p className="text-ink-2 mt-1 line-clamp-3">{x.body}</p>
                    <p className="text-xs text-ink-3 mt-0.5">{formatDateTime(x.createdAt)}{x.skipReason ? ` · ${x.skipReason}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
