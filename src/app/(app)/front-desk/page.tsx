import { DealerName } from "@/components/ui";
import { dealerColors } from "@/server/dealer-colors";
import Link from "next/link";
import clsx from "clsx";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listFrontDesk, catalogueForDealership } from "@/server/services/crm";
import { loadDealers } from "@/server/analytics";
import { can, dealershipScope } from "@/domain/permissions";
import { businessDate, isIsoDate, formatDateShort, addDays } from "@/domain/periods";
import { VISIT_LABELS } from "@/domain/crm";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Chip, EmptyState, Notice } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { attendAction, closeVisitAction, openJobAction, staffWalkInAction } from "../leads/actions";

export const metadata = { title: "Front desk" };
const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const TYPE_TONE = { new_car: "petrol", service: "info", spare_parts: "neutral", body_shop: "warn" } as const;

export default async function FrontDeskPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("frontdesk.view");
  const dc = await dealerColors();
  const sp = await searchParams;
  const today = businessDate();
  const day = isIsoDate(first(sp.date)) ? first(sp.date)! : today;
  const db = await getDb();
  const dealers = (await loadDealers(db, dealershipScope(actor)));
  const dealerId = first(sp.dealer) ?? (dealers.length === 1 ? dealers[0].id : undefined);
  const rows = await listFrontDesk(db, actor, day, dealerId);
  const catalogue = dealerId && can(actor, "leads.manage") ? await catalogueForDealership(db, dealerId) : [];
  const now = Date.now();
  const groups = {
    waiting: rows.filter((r) => r.w.status === "waiting"),
    attending: rows.filter((r) => r.w.status === "attending"),
    closed: rows.filter((r) => r.w.status === "done" || r.w.status === "left"),
  };
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.w.visitType] = (a[r.w.visitType] ?? 0) + 1), a), {});

  return (
    <>
      {day === today && <AutoRefresh seconds={30} />}
      <PageHeader
        title="Front desk"
        subtitle={`${formatDateShort(day)}${day === today ? " · updates every 30 seconds" : ""} · ${rows.length} visitors: ${Object.entries(counts).map(([k, c]) => `${c} ${VISIT_LABELS[k as keyof typeof VISIT_LABELS].toLowerCase()}`).join(", ") || "none yet"}`}
        actions={
          <>
            <Link href={`/front-desk?date=${addDays(day, -1)}${dealerId ? `&dealer=${dealerId}` : ""}`} className="btn-secondary btn-sm">‹ Prev day</Link>
            {day < today && <Link href={`/front-desk${dealerId ? `?dealer=${dealerId}` : ""}`} className="btn-secondary btn-sm">Today</Link>}
          </>
        }
      />
      {first(sp.kiosk) === "staff" && <div className="mb-4"><Notice>Kiosk screens open only on kiosk device accounts. An administrator can create one under Administration → Users (role “Kiosk device”).</Notice></div>}
      {dealers.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4 text-[13px]">
          <Link href={`/front-desk?date=${day}`} className={`chip ${!dealerId ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>All</Link>
          {dealers.map((d) => <Link key={d.id} href={`/front-desk?date=${day}&dealer=${d.id}`} className={`chip ${dealerId === d.id ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}><DealerName name={d.name} color={dc.of(d.id)} size="sm" /></Link>)}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4">
          {(["waiting", "attending", "closed"] as const).map((g) => (
            <Panel key={g} title={g === "waiting" ? `Waiting (${groups.waiting.length})` : g === "attending" ? `Being attended (${groups.attending.length})` : `Closed (${groups.closed.length})`} bodyClassName="px-0 pb-1">
              {!groups[g].length ? <p className="px-4 pb-3 text-sm text-ink-3">{g === "waiting" ? "No one waiting." : "None."}</p> : (
                <ul className="divide-y divide-line">
                  {groups[g].map((r) => {
                    const mins = Math.round((now - r.w.createdAt.getTime()) / 60000);
                    return (
                      <li key={r.w.id} className="px-4 py-3 flex flex-wrap items-start gap-3">
                        <div className="w-20 shrink-0">
                          <p className="text-2xl font-bold num leading-none">{r.w.token}</p>
                          <p className={clsx("text-xs mt-1", g === "waiting" && mins > 10 ? "text-crit font-medium" : "text-ink-3")}>{time.format(r.w.createdAt)}{g === "waiting" ? ` · ${mins} min` : ""}</p>
                        </div>
                        <div className="flex-1 min-w-[200px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip tone={TYPE_TONE[r.w.visitType]}>{VISIT_LABELS[r.w.visitType]}</Chip>
                            <span className="font-medium">{r.customerName}</span>
                            {r.phone && <a href={`tel:${r.phone}`} className="text-sm text-petrol">{r.phone}</a>}
                          </div>
                          <p className="text-sm text-ink-2 mt-1">{[r.w.registrationNo, r.w.vehicleModel, r.w.request].filter(Boolean).join(" · ") || (r.w.visitType === "new_car" ? "New-car enquiry" : "")}{r.w.insuranceClaim ? " · insurance claim" : ""}</p>
                          <p className="text-xs text-ink-3 mt-0.5">
                            {r.w.capturedVia === "kiosk" ? "Kiosk" : "Front desk"}{dealers.length > 1 && <> · <DealerName name={r.dealershipName} color={dc.of(r.dealershipName)} size="sm" /></>}{r.attendedBy ? ` · ${r.attendedBy}` : ""}
                            {r.leadNo && <> · <Link href={`/leads/${r.w.leadId}`} className="text-petrol hover:underline">{r.leadNo}</Link></>}
                            {r.jobNo && <> · <Link href={`/jobs/${r.w.jobId}`} className="text-petrol hover:underline">{r.jobNo}</Link></>}
                            {r.w.outcomeNote && <> · {r.w.outcomeNote}</>}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {g === "waiting" && <ActionForm action={attendAction}><input type="hidden" name="id" value={r.w.id} /><Submit className="btn-primary btn-sm">Attend</Submit></ActionForm>}
                          {g !== "closed" && r.w.visitType === "new_car" && r.w.leadId && can(actor, "leads.view") && <Link href={`/leads/${r.w.leadId}`} className="btn-secondary btn-sm">Open enquiry</Link>}
                          {g !== "closed" && (r.w.visitType === "service" || r.w.visitType === "body_shop") && !r.w.jobId && can(actor, "jobs.create") && (
                            <ActionForm action={openJobAction}><input type="hidden" name="id" value={r.w.id} /><Submit className="btn-secondary btn-sm" pendingText="Opening…">Open job card</Submit></ActionForm>
                          )}
                          {g === "attending" && (
                            <ActionForm action={closeVisitAction} className="flex items-center gap-1">
                              <input type="hidden" name="id" value={r.w.id} />
                              <input name="note" placeholder="Outcome (optional)" className="field h-8 w-40 text-[13px]" aria-label="Outcome note" />
                              <Submit className="btn-ghost btn-sm" name="status" value="done">Done</Submit>
                            </ActionForm>
                          )}
                          {g === "waiting" && <ActionForm action={closeVisitAction}><input type="hidden" name="id" value={r.w.id} /><input type="hidden" name="note" value="Left before being attended" /><Submit className="btn-ghost btn-sm" name="status" value="left">Left</Submit></ActionForm>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          ))}
          {!rows.length && <Panel><EmptyState title="No visitors recorded for this day" icon="users">Customers check in on the showroom kiosk, or add them with the form.</EmptyState></Panel>}
        </div>
        <Panel title="Add a walk-in" subtitle="For customers who come straight to the desk">
          {!dealerId ? <p className="text-sm text-ink-3">Choose a dealership above first.</p> : (
            <ActionForm action={staffWalkInAction} resetOnSuccess className="space-y-3">
              <input type="hidden" name="dealershipId" value={dealerId} />
              <label className="block"><span className="label">Visit type</span>
                <select name="visitType" className="field">
                  {(can(actor, "leads.manage") ? (["new_car", "service", "spare_parts", "body_shop"] as const) : (["service", "spare_parts", "body_shop"] as const)).map((t) => <option key={t} value={t}>{VISIT_LABELS[t]}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">Name</span><input name="name" required className="field" /></label>
                <label><span className="label">Mobile</span><input name="phone" required inputMode="numeric" className="field" /></label>
              </div>
              {catalogue.length > 0 && (
                <fieldset><legend className="label">Models of interest (new car)</legend>
                  <div className="grid grid-cols-2 gap-1 text-sm">{catalogue.map((m) => <label key={m.id} className="flex items-center gap-1.5"><input type="checkbox" name="modelIds" value={m.id} />{m.name}</label>)}</div>
                  <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" name="testDrive" /> Wants a test drive</label>
                </fieldset>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">Registration (service/body)</span><input name="registrationNo" className="field uppercase" /></label>
                <label><span className="label">Car model</span><input name="vehicleModel" className="field" /></label>
              </div>
              <label className="block"><span className="label">Request / part / damage</span><input name="request" className="field" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="consentUpdates" defaultChecked /> Customer agrees to visit updates (WhatsApp/SMS)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="consentMarketing" /> Customer agrees to offers / news (marketing)</label>
              <Submit>Record walk-in</Submit>
            </ActionForm>
          )}
        </Panel>
      </div>
    </>
  );
}
