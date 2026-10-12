import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listAppointments } from "@/server/services/appointments";
import { loadDealers } from "@/server/analytics";
import { dealershipScope } from "@/domain/permissions";
import { addDays, businessDate, isIsoDate, rangeToInstants, formatDateShort } from "@/domain/periods";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, Chip, EmptyState } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createAppointmentAction, checkInAction, appointmentStatusAction } from "./actions";

export const metadata = { title: "Appointments" };
const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const STATUS = { scheduled: { t: "info", l: "Scheduled" }, attended: { t: "good", l: "Checked in" }, no_show: { t: "warn", l: "No-show" }, cancelled: { t: "neutral", l: "Cancelled" } } as const;

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("appointments.manage");
  const sp = await searchParams;
  const today = businessDate();
  const day = isIsoDate(first(sp.date)) ? first(sp.date)! : today;
  const db = await getDb();
  const [rows, dealers] = await Promise.all([listAppointments(db, actor, rangeToInstants({ start: day, end: day })), loadDealers(db, dealershipScope(actor))]);
  const scheduled = rows.filter((r) => r.a.status === "scheduled").length;
  const now = new Date();

  return (
    <>
      <PageHeader title="Appointments" subtitle={`${formatDateShort(day)}${day === today ? " (today)" : ""} · ${rows.length} booked, ${scheduled} still to arrive`} />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link href={`/appointments?date=${addDays(day, -1)}`} className="btn-secondary btn-sm" aria-label="Previous day">‹ Prev</Link>
        <form action="/appointments" className="flex gap-2"><input type="date" name="date" defaultValue={day} className="field h-8 w-auto" aria-label="Date" /><button className="btn-secondary btn-sm">Go</button></form>
        <Link href={`/appointments?date=${addDays(day, 1)}`} className="btn-secondary btn-sm" aria-label="Next day">Next ›</Link>
        {day !== today && <Link href="/appointments" className="btn-ghost btn-sm">Today</Link>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Schedule" bodyClassName="px-0 pb-1">
          {!rows.length ? <EmptyState title="No appointments on this day" icon="calendar">Book one with the form.</EmptyState> : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const st = STATUS[r.a.status];
                const late = r.a.status === "scheduled" && r.a.scheduledAt < now;
                return (
                  <li key={r.a.id} className="px-4 py-3 flex flex-wrap items-start gap-3">
                    <div className="w-20 shrink-0">
                      <p className="font-semibold num">{time.format(r.a.scheduledAt)}</p>
                      {late && <p className="text-xs text-warn">Not arrived</p>}
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <p className="font-medium">{r.reg} <span className="text-ink-3 text-sm font-normal">{r.model}</span></p>
                      <p className="text-sm text-ink-2">{r.customerName} · {r.a.requestedWork}</p>
                      {dealers.length > 1 && <p className="text-xs text-ink-3">{r.dealershipName}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={st.t}>{st.l}</Chip>
                      {r.a.jobId && <Link href={`/jobs/${r.a.jobId}`} className="text-sm text-petrol hover:underline">{r.jobNo}</Link>}
                      {r.a.status === "scheduled" && (
                        <>
                          <ActionForm action={checkInAction}><input type="hidden" name="id" value={r.a.id} /><Submit className="btn-primary btn-sm" pendingText="Opening…">Check in & open job card</Submit></ActionForm>
                          <ActionForm action={appointmentStatusAction}><input type="hidden" name="id" value={r.a.id} /><input type="hidden" name="status" value="no_show" /><Submit className="btn-secondary btn-sm">No-show</Submit></ActionForm>
                          <ActionForm action={appointmentStatusAction}><input type="hidden" name="id" value={r.a.id} /><input type="hidden" name="status" value="cancelled" /><Submit className="btn-ghost btn-sm">Cancel</Submit></ActionForm>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Book an appointment" subtitle="The customer is sent a confirmation if they consent">
          <ActionForm action={createAppointmentAction} resetOnSuccess className="space-y-3">
            {dealers.length > 1 ? (
              <label className="block"><span className="label">Dealership</span><select name="dealershipId" className="field">{dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            ) : <input type="hidden" name="dealershipId" value={dealers[0]?.id ?? ""} />}
            <div className="grid grid-cols-2 gap-2">
              <label><span className="label">Date</span><input type="date" name="date" defaultValue={day < today ? today : day} min={today} className="field" required /></label>
              <label><span className="label">Time</span><input type="time" name="time" defaultValue="10:00" className="field" required /></label>
            </div>
            <label className="block"><span className="label">Type</span><select name="jobType" className="field"><option value="service">Service</option><option value="bodyshop">Body shop</option></select></label>
            <label className="block"><span className="label">Registration number</span><input name="registrationNo" required className="field uppercase" /></label>
            <label className="block"><span className="label">Model</span><input name="model" className="field" /></label>
            <label className="block"><span className="label">Customer name</span><input name="customerName" required className="field" /></label>
            <label className="block"><span className="label">Mobile</span><input name="phone" type="tel" className="field" /></label>
            <label className="block"><span className="label">Requested work</span><input name="requestedWork" required className="field" /></label>
            <fieldset className="text-sm"><legend className="label">Consent to updates</legend>
              <div className="flex gap-4"><label className="flex items-center gap-1.5"><input type="checkbox" name="consentWhatsapp" /> WhatsApp</label><label className="flex items-center gap-1.5"><input type="checkbox" name="consentSms" /> SMS</label><label className="flex items-center gap-1.5"><input type="checkbox" name="consentEmail" /> Email</label></div>
            </fieldset>
            <Submit pendingText="Booking…">Book appointment</Submit>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
