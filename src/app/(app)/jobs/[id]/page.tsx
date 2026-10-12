import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { getJobDetail } from "@/server/services/jobs";
import { NotFoundError } from "@/server/errors";
import { can, canMoveJob, ForbiddenError } from "@/domain/permissions";
import { checkTransition, nextStage, APPROVAL_STAGES, type CommonStage } from "@/domain/workflow";
import { EVENT_LABELS } from "@/domain/notifications";
import { businessDate } from "@/domain/periods";
import { formatDateTime, formatInr, relativeTime } from "@/domain/format";
import { PageHeader, Panel, Chip, KeyValue, Notice } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { StageChip, DueText, BLOCKER_LABELS } from "@/components/jobs";
import { Icon } from "@/components/Icon";
import {
  transitionAction, updateJobAction, approvalAction, cancelAction, noteAction, checklistAction, addPartAction, partStatusAction, labourAction, photoAction,
} from "../actions";
import { retryNotificationAction } from "../../notifications/actions";

export const metadata = { title: "Job card" };

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

const NOTIF_TONE = { sent: "good", failed: "crit", skipped: "neutral", queued: "info" } as const;

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requireCap("jobs.view");
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getJobDetail>>;
  try {
    d = await getJobDetail(await getDb(), actor, id);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
  const { job, vehicle, customer, dealership, stages } = d;
  const open = job.status === "open";
  const manage = can(actor, "jobs.manage");
  const mineAsTech = can(actor, "jobs.work") && job.assignedToId === actor.id;
  const canWork = open && (manage || mineAsTech);
  const curIdx = stages.findIndex((s) => s.code === job.stageCode);
  const next = nextStage(stages, job.stageCode);
  const nextCheck = next ? checkTransition(stages, job, next.code) : null;
  const canMoveNext = !!next && open && canMoveJob(actor, job, { fromCommon: job.commonStage, toCommon: next.commonStage, direction: "forward" });
  const due = job.promisedAt ?? job.expectedCompletionAt;
  const overdue = open && !!due && due < new Date();
  const hidden = (
    <>
      <input type="hidden" name="jobId" value={job.id} />
      <input type="hidden" name="version" value={job.version} />
    </>
  );
  const F = (name: string) => <input type="hidden" name="_fields" value={name} />;

  return (
    <>
      <PageHeader
        back={{ href: job.jobType === "bodyshop" ? "/bodyshop" : "/jobs", label: job.jobType === "bodyshop" ? "Body shop" : "Jobs" }}
        title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">{vehicle.registrationNo}<span className="text-base font-normal text-ink-2">{vehicle.make} {vehicle.model}</span></span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{job.jobNo} · {job.jobType === "service" ? "Service" : "Body shop"} · {dealership.name}</span>
            <StageChip common={job.commonStage} label={stages[curIdx]?.label} />
            {job.status === "cancelled" && <Chip tone="crit">Cancelled</Chip>}
            {overdue && <Chip tone="crit">Overdue</Chip>}
            {job.blocker !== "none" && <Chip tone="warn">{BLOCKER_LABELS[job.blocker]}</Chip>}
            {job.isDemo && <Chip tone="neutral">Demo record</Chip>}
          </span>
        }
      />
      {created && <div className="mb-4"><Notice tone="good" title="Job card created">The customer has been sent a “vehicle received” update if they consented to messages. See Customer updates below.</Notice></div>}

      {/* Stage progress */}
      <Panel className="mb-4" bodyClassName="py-3">
        <p className="text-xs text-ink-2 mb-2 sm:hidden">Stage {curIdx + 1} of {stages.length}: <span className="font-semibold text-ink">{stages[curIdx]?.label}</span></p>
        <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Workflow stages">
          {stages.map((s, i) => (
            <li key={s.code} className="flex-1 min-w-[84px]" aria-current={i === curIdx ? "step" : undefined}>
              <div className={clsx("h-1.5 rounded-full", i < curIdx || job.status === "closed" ? "bg-petrol" : i === curIdx ? "bg-hazard" : "bg-line")} />
              <p className={clsx("mt-1.5 text-xs leading-tight", i === curIdx ? "font-semibold text-ink" : i < curIdx ? "text-ink-2" : "text-ink-3")}>{s.label}</p>
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* Next step */}
          {open && (
            <Panel title="Next step" subtitle={`In “${stages[curIdx]?.label}” since ${relativeTime(job.stageEnteredAt)}`} className="border-petrol/40">
              {job.approvalStatus === "pending" && APPROVAL_STAGES.includes(job.commonStage as CommonStage) && manage && (
                <div className="mb-4 rounded border border-warn/40 bg-warn-soft p-3">
                  <p className="font-medium text-sm">Approval needed{job.insurerName ? ` from ${job.insurerName} / customer` : " from the customer"}</p>
                  <p className="text-xs text-ink-2 mt-0.5">Estimate {formatInr(job.estimateAmount)}. Record the decision when you receive it.</p>
                  <ActionForm action={approvalAction} className="mt-2 flex flex-wrap items-end gap-2">
                    {hidden}
                    <label className="text-xs text-ink-2">Approved amount (₹)<input name="approvedAmount" inputMode="decimal" defaultValue={job.estimateAmount ?? ""} className="field h-9 w-40 mt-0.5" /></label>
                    <label className="text-xs text-ink-2 flex-1 min-w-[160px]">Note<input name="note" className="field h-9 mt-0.5" placeholder="e.g. Approved by phone" /></label>
                    <Submit className="btn-primary h-9" name="decision" value="approved">Record approval</Submit>
                    <Submit className="btn-danger h-9" name="decision" value="declined">Record decline</Submit>
                  </ActionForm>
                </div>
              )}
              {next ? (
                <ActionForm action={transitionAction} className="flex flex-col sm:flex-row sm:items-center gap-3">
                  {hidden}
                  <input type="hidden" name="toStage" value={next.code} />
                  <Submit className="btn-primary h-12 sm:h-10 text-base sm:text-sm w-full sm:w-auto" pendingText="Moving…">
                    Move to {next.label} <Icon name="chevron" />
                  </Submit>
                  {!canMoveNext ? (
                    <p className="text-sm text-ink-2">{actor.role === "technician" ? "The service advisor moves the job from here." : "Your role can't make this move."}</p>
                  ) : nextCheck && !nextCheck.ok ? (
                    <p className="text-sm text-warn flex items-start gap-1.5"><Icon name="info" className="h-4 w-4 mt-0.5 shrink-0" />{nextCheck.reason}</p>
                  ) : null}
                </ActionForm>
              ) : null}
              {manage && curIdx > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-petrol">Send back for rework, or cancel</summary>
                  <div className="grid gap-4 sm:grid-cols-2 mt-3">
                    <ActionForm action={transitionAction} className="space-y-2">
                      {hidden}
                      <label className="label" htmlFor="rework-to">Send back to</label>
                      <select id="rework-to" name="toStage" className="field">
                        {stages.slice(0, curIdx).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                      </select>
                      <input name="reason" required placeholder="Reason (required), e.g. QC failed: brake noise" className="field" />
                      <Submit className="btn-secondary">Send back</Submit>
                    </ActionForm>
                    <ActionForm action={cancelAction} className="space-y-2">
                      {hidden}
                      <label className="label" htmlFor="cancel-reason">Cancel job</label>
                      <input id="cancel-reason" name="reason" required placeholder="Reason (required)" className="field" />
                      <Submit className="btn-danger">Cancel job</Submit>
                    </ActionForm>
                  </div>
                </details>
              )}
            </Panel>
          )}

          {/* Job details */}
          <Panel title="Job details">
            {manage && open ? (
              <ActionForm action={updateJobAction} className="space-y-4">
                {hidden}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2"><span className="label">Customer complaint / requested work</span>{F("complaint")}<textarea name="complaint" rows={2} defaultValue={job.complaint ?? ""} className="field" /></label>
                  <label><span className="label">Assigned technician</span>{F("assignedToId")}
                    <select name="assignedToId" defaultValue={job.assignedToId ?? ""} className="field">
                      <option value="">Unassigned</option>
                      {d.technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                  {job.jobType === "bodyshop" && <label><span className="label">Team</span>{F("team")}<input name="team" defaultValue={job.team ?? ""} className="field" /></label>}
                  <label><span className="label">Odometer (km)</span>{F("odometerKm")}<input name="odometerKm" inputMode="numeric" defaultValue={job.odometerKm ?? ""} className="field" /></label>
                  <label><span className="label">Estimate (₹, ex-tax)</span>{F("estimateAmount")}<input name="estimateAmount" inputMode="decimal" defaultValue={job.estimateAmount ?? ""} className="field" /></label>
                  <label><span className="label">Estimated labour hours</span>{F("estimatedHours")}<input name="estimatedHours" inputMode="decimal" defaultValue={job.estimatedHours ?? ""} className="field" /></label>
                  <label><span className="label">Promised delivery</span>{F("promisedAt")}<input type="datetime-local" name="promisedAt" defaultValue={toLocalInput(job.promisedAt)} className="field" /></label>
                  <label><span className="label">Expected completion (if later)</span>{F("expectedCompletionAt")}<input type="datetime-local" name="expectedCompletionAt" defaultValue={toLocalInput(job.expectedCompletionAt)} className="field" /></label>
                  <label><span className="label">Blocker</span>{F("blocker")}
                    <select name="blocker" defaultValue={job.blocker} className="field">
                      {Object.entries(BLOCKER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label><span className="label">Delay reason</span>{F("delayReason")}<input name="delayReason" defaultValue={job.delayReason ?? ""} className="field" placeholder="Shown to the customer if delivery slips" /></label>
                  <label className="sm:col-span-2"><span className="label">Next action</span>{F("nextAction")}<input name="nextAction" defaultValue={job.nextAction ?? ""} className="field" /></label>
                  {job.jobType === "bodyshop" && (
                    <>
                      <label><span className="label">Insurer</span>{F("insurerName")}<input name="insurerName" defaultValue={job.insurerName ?? ""} className="field" /></label>
                      <label><span className="label">Claim reference</span>{F("claimRef")}<input name="claimRef" defaultValue={job.claimRef ?? ""} className="field" /></label>
                    </>
                  )}
                  <label><span className="label">Invoice reference</span>{F("invoiceRef")}<input name="invoiceRef" defaultValue={job.invoiceRef ?? ""} className="field" /></label>
                  <label><span className="label">Payment status</span>{F("paymentStatus")}
                    <select name="paymentStatus" defaultValue={job.paymentStatus} className="field">
                      <option value="unbilled">Not billed</option><option value="unpaid">Billed, unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">{F("isComeback")}<input type="checkbox" name="isComeback" defaultChecked={job.isComeback} className="h-4 w-4" /> Comeback (repeat repair for the same issue)</label>
                </div>
                <Submit>Save changes</Submit>
              </ActionForm>
            ) : (
              <>
                <dl className="grid gap-3 sm:grid-cols-3">
                  <KeyValue label="Complaint">{job.complaint}</KeyValue>
                  <KeyValue label="Technician">{d.assignee?.name ?? "Unassigned"}</KeyValue>
                  <KeyValue label="Promised"><DueText due={due} status={job.status} /></KeyValue>
                  <KeyValue label="Odometer">{job.odometerKm ? `${job.odometerKm.toLocaleString("en-IN")} km` : "—"}</KeyValue>
                  {can(actor, "jobs.manage") && <KeyValue label="Estimate">{formatInr(job.estimateAmount)}</KeyValue>}
                  <KeyValue label="Next action">{job.nextAction ?? "—"}</KeyValue>
                  {job.deliveredAt && <KeyValue label="Delivered">{formatDateTime(job.deliveredAt)}</KeyValue>}
                  {job.invoiceRef && <KeyValue label="Invoice">{job.invoiceRef}</KeyValue>}
                </dl>
                {mineAsTech && open && (
                  <ActionForm action={updateJobAction} className="mt-4 grid gap-3 sm:grid-cols-3 items-end border-t border-line pt-4">
                    {hidden}
                    <label><span className="label">Report a blocker</span>{F("blocker")}
                      <select name="blocker" defaultValue={job.blocker} className="field">
                        {Object.entries(BLOCKER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label><span className="label">Reason</span>{F("delayReason")}<input name="delayReason" defaultValue={job.delayReason ?? ""} className="field" /></label>
                    <Submit className="btn-secondary">Update</Submit>
                  </ActionForm>
                )}
              </>
            )}
          </Panel>

          {/* Inspection checklist */}
          <Panel title={job.jobType === "service" ? "Inspection checklist" : "Intake checklist"} subtitle={`${d.checklist.filter((c) => c.result !== "pending").length} of ${d.checklist.length} checked`} bodyClassName="px-0 pb-1">
            <ul className="divide-y divide-line">
              {d.checklist.map((c) => (
                <li key={c.id} className="px-4 py-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{c.item}</span>
                  {canWork ? (
                    <ActionForm action={checklistAction} className="inline-flex rounded border border-line-strong p-0.5">
                      <input type="hidden" name="jobId" value={job.id} />
                      <input type="hidden" name="itemId" value={c.id} />
                      {(["ok", "attention", "na"] as const).map((r) => (
                        <button key={r} name="result" value={r} aria-pressed={c.result === r} className={clsx("px-3 h-8 text-[13px] rounded-sm", c.result === r ? (r === "ok" ? "bg-good text-white" : r === "attention" ? "bg-warn text-white" : "bg-ink-2 text-white") : "text-ink-2")}>
                          {r === "ok" ? "OK" : r === "attention" ? "Needs attention" : "N/A"}
                        </button>
                      ))}
                    </ActionForm>
                  ) : (
                    <Chip tone={c.result === "ok" ? "good" : c.result === "attention" ? "warn" : "neutral"}>{c.result === "na" ? "N/A" : c.result === "attention" ? "Needs attention" : c.result === "ok" ? "OK" : "Not checked"}</Chip>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Parts */}
            <Panel title="Parts" subtitle="Requested for this job">
              {!d.parts.length && <p className="text-sm text-ink-3 mb-2">No parts requested.</p>}
              <ul className="space-y-2 mb-3">
                {d.parts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{p.description} <span className="text-ink-3">× {p.quantity}{p.partNo ? ` · ${p.partNo}` : ""}</span></span>
                    {manage && open ? (
                      <ActionForm action={partStatusAction}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="partId" value={p.id} />
                        <select name="status" defaultValue={p.status} className="field h-8 w-auto text-[13px]" aria-label={`Status of ${p.description}`}>
                          <option value="requested">Requested</option><option value="issued">Issued</option><option value="unavailable">Unavailable</option><option value="returned">Returned</option>
                        </select>
                        <Submit className="btn-ghost btn-sm ml-1">Set</Submit>
                      </ActionForm>
                    ) : (
                      <Chip tone={p.status === "issued" ? "good" : p.status === "unavailable" ? "crit" : "neutral"}>{p.status}</Chip>
                    )}
                  </li>
                ))}
              </ul>
              {canWork && (
                <ActionForm action={addPartAction} resetOnSuccess className="grid grid-cols-[1fr_4.5rem] gap-2 border-t border-line pt-3">
                  <input type="hidden" name="jobId" value={job.id} />
                  <input name="description" required placeholder="Part description" className="field" aria-label="Part description" />
                  <input name="quantity" inputMode="decimal" defaultValue="1" className="field" aria-label="Quantity" />
                  <input name="partNo" placeholder="Part number (optional)" className="field" aria-label="Part number" />
                  <Submit className="btn-secondary">Request</Submit>
                </ActionForm>
              )}
            </Panel>

            {/* Labour */}
            <Panel title="Labour time" subtitle={`${d.labourHours.toFixed(1)} productive hours logged`}>
              <ul className="space-y-1 mb-3 text-sm">
                {d.labour.map((l) => <li key={l.id} className="flex justify-between"><span>{l.workDate} <span className="text-ink-3 text-xs">{l.resourceType.replace("_", " ")}</span></span><span className="num">{l.hours.toFixed(2)} h</span></li>)}
                {!d.labour.length && <li className="text-ink-3">No time logged yet.</li>}
              </ul>
              {canWork && (
                <ActionForm action={labourAction} resetOnSuccess className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                  <input type="hidden" name="jobId" value={job.id} />
                  <label className="text-xs text-ink-2">Hours<input name="hours" inputMode="decimal" required className="field w-24 mt-0.5" /></label>
                  <label className="text-xs text-ink-2">Date<input type="date" name="workDate" defaultValue={businessDate()} max={businessDate()} className="field mt-0.5" /></label>
                  <Submit className="btn-secondary">Log time</Submit>
                </ActionForm>
              )}
            </Panel>
          </div>

          {/* Photos */}
          <Panel title="Photos" subtitle={job.jobType === "bodyshop" ? "Damage and repair stages" : "Condition at intake and findings"}>
            {d.photos.length ? (
              <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {d.photos.map((p) => (
                  <li key={p.id}>
                    <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer" className="block aspect-[4/3] overflow-hidden rounded border border-line bg-page">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/photos/${p.id}`} alt={p.caption ?? "Job photo"} className="h-full w-full object-cover" loading="lazy" />
                    </a>
                    {p.caption && <p className="text-xs text-ink-2 mt-0.5 truncate">{p.caption}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-3 mb-3">No photos yet.</p>}
            {canWork && (
              <ActionForm action={photoAction} resetOnSuccess className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="jobId" value={job.id} />
                <label className="btn-secondary cursor-pointer"><Icon name="camera" /> Choose or take photo<input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" className="sr-only" required /></label>
                <input name="caption" placeholder="Caption (optional)" className="field flex-1 min-w-[160px]" aria-label="Caption" />
                <Submit className="btn-secondary" pendingText="Uploading…">Upload</Submit>
              </ActionForm>
            )}
          </Panel>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <Panel title="Customer">
            <dl className="space-y-2">
              <KeyValue label="Name">{customer.name}</KeyValue>
              {customer.contactHidden ? (
                <p className="text-xs text-ink-3">Contact details are visible to service advisors and managers.</p>
              ) : (
                <>
                  <KeyValue label="Phone">{customer.phone ? <a href={`tel:${customer.phone}`} className="text-petrol">{customer.phone}</a> : "—"}</KeyValue>
                  <KeyValue label="Email">{customer.email ?? "—"}</KeyValue>
                </>
              )}
              <KeyValue label="Message consent">
                <span className="flex flex-wrap gap-1">
                  {(["whatsapp", "sms", "email"] as const).map((c) => <Chip key={c} tone={customer.consent[c] ? "good" : "neutral"}>{c === "whatsapp" ? "WhatsApp" : c.toUpperCase()} {customer.consent[c] ? "yes" : "no"}</Chip>)}
                </span>
              </KeyValue>
            </dl>
          </Panel>

          <Panel title="Customer updates" subtitle="Sent on verified milestones only" bodyClassName="px-0 pb-1">
            {!d.notifications.length ? <p className="px-4 pb-3 text-sm text-ink-3">No updates yet.</p> : (
              <ul className="divide-y divide-line">
                {d.notifications.map((n) => (
                  <li key={n.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{EVENT_LABELS[n.event]}</span>
                      <Chip tone={NOTIF_TONE[n.status]}>{n.status}</Chip>
                    </div>
                    <p className="text-xs text-ink-3 mt-0.5">
                      {n.channel ? `${n.channel} · ` : ""}{formatDateTime(n.createdAt)}{n.provider === "console-simulated" ? " · simulated (no provider connected)" : ""}
                    </p>
                    {n.skipReason && <p className="text-xs text-ink-2">{n.skipReason}</p>}
                    {n.lastError && <p className="text-xs text-crit">{n.lastError}</p>}
                    {n.status === "failed" && can(actor, "notifications.retry") && (
                      <ActionForm action={retryNotificationAction} className="mt-1">
                        <input type="hidden" name="id" value={n.id} />
                        <Submit className="btn-ghost btn-sm" pendingText="Retrying…">Retry</Submit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Timeline" subtitle="Every change is recorded with who and when" bodyClassName="px-0 pb-1">
            {(manage || mineAsTech) && open && (
              <ActionForm action={noteAction} resetOnSuccess className="px-4 pb-3 flex gap-2">
                <input type="hidden" name="jobId" value={job.id} />
                <input name="text" required placeholder="Add a note" className="field" aria-label="Note" />
                <Submit className="btn-secondary">Add</Submit>
              </ActionForm>
            )}
            <ol className="border-t border-line max-h-[520px] overflow-y-auto">
              {d.events.map(({ e, userName }) => {
                const label = (code: string | null) => stages.find((s) => s.code === code)?.label ?? code;
                const text =
                  e.type === "created" ? `Job card opened in ${label(e.toValue)}`
                  : e.type === "stage_change" ? `${label(e.fromValue)} → ${label(e.toValue)}`
                  : e.type === "note" ? e.reason
                  : `${e.field?.replace(/([A-Z])/g, " $1").toLowerCase()}: ${e.fromValue ? `${e.fromValue} → ` : ""}${e.toValue ?? "cleared"}`;
                return (
                  <li key={e.id} className="px-4 py-2 border-b border-line last:border-0">
                    <p className={clsx("text-sm", e.type === "stage_change" && "font-medium")}>{text}</p>
                    {e.reason && e.type !== "note" && <p className="text-xs text-ink-2">Reason: {e.reason}</p>}
                    <p className="text-xs text-ink-3">{userName ?? "System"} · {formatDateTime(e.at)}</p>
                  </li>
                );
              })}
            </ol>
          </Panel>
          {can(actor, "audit.view") && (
            <p className="text-xs text-ink-3 px-1">
              <Link href={`/admin/audit?entity=job&id=${job.id}`} prefetch={false} className="hover:underline">View full audit record</Link>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
