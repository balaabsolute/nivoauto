import { DealerName } from "@/components/ui";
import { dealerColors } from "@/server/dealer-colors";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listAlerts, alertOwnerOptions } from "@/server/services/reporting";
import { can } from "@/domain/permissions";
import { describeEvidence, ALERT_THRESHOLDS } from "@/domain/alerts";
import { formatDateTime } from "@/domain/format";
import { businessDate } from "@/domain/periods";
import { first, type SP } from "@/server/period-params";
import Link from "next/link";
import { PageHeader, Panel, SeverityChip, Chip, EmptyState } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { updateAlertAction } from "./actions";

export const metadata = { title: "Management actions" };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("alerts.view");
  const dc = await dealerColors();
  const includeClosed = first((await searchParams).closed) === "1";
  const db = await getDb();
  const rows = await listAlerts(db, actor, { includeClosed });
  const manage = can(actor, "alerts.manage");
  const ownerCache = new Map<string, { id: string; name: string }[]>();
  for (const r of rows) {
    const k = r.a.dealershipId ?? "group";
    if (manage && !ownerCache.has(k)) ownerCache.set(k, await alertOwnerOptions(db, actor, r.a.dealershipId));
  }
  const unowned = rows.filter((r) => !r.a.ownerId && r.a.active).length;

  return (
    <>
      <PageHeader
        title="Management actions"
        subtitle={`${rows.length} ${includeClosed ? "" : "open "}exceptions · ${unowned} active without an owner`}
        actions={<Link href={includeClosed ? "/alerts" : "/alerts?closed=1"} className="btn-secondary btn-sm">{includeClosed ? "Hide resolved" : "Show resolved & dismissed"}</Link>}
      />
      <p className="text-sm text-ink-2 mb-4 max-w-3xl">
        Alerts come from transparent rules evaluated whenever a dashboard is viewed. Each states the observed fact and evidence; a suggested investigation is a starting point, not a diagnosis. An alert that stops firing is marked “no longer firing” but keeps its owner and history.
      </p>
      {!rows.length ? <Panel><EmptyState title="No open management actions" icon="check" /></Panel> : (
        <ul className="space-y-3">
          {rows.map(({ a, dealershipName, ownerName }) => (
            <li key={a.id} className="panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityChip severity={a.severity} />
                <span className="font-semibold">{a.title}</span>
                <span className="text-sm text-ink-2">{dealershipName ? <DealerName name={dealershipName} color={dc.of(dealershipName)} size="sm" /> : "Group"}</span>
                {!a.active && <Chip tone="neutral">No longer firing</Chip>}
                <Chip tone={a.status === "resolved" ? "good" : a.status === "dismissed" ? "neutral" : a.status === "open" ? "info" : "petrol"}>{a.status.replace("_", " ")}</Chip>
              </div>
              <p className="text-sm mt-2">{a.observedFact}</p>
              <div className="grid gap-4 md:grid-cols-2 mt-3">
                <div className="text-sm">
                  <p className="text-xs font-medium text-ink-2">Evidence</p>
                  <ul className="text-ink-2 num">{describeEvidence(a.evidence).map((e) => <li key={e}>{e}</li>)}</ul>
                  <p className="text-xs text-ink-3 mt-1">Source: {a.source} · Period: {a.periodLabel} · First seen {formatDateTime(a.firstSeenAt)} · Last seen {formatDateTime(a.lastSeenAt)}</p>
                  <p className="mt-2"><span className="text-xs font-medium text-ink-2 block">Suggested investigation</span>{a.suggestedInvestigation}</p>
                  {a.resolutionNote && <p className="mt-2"><span className="text-xs font-medium text-ink-2 block">Action note</span>{a.resolutionNote}</p>}
                </div>
                {manage ? (
                  <ActionForm action={updateAlertAction} className="grid grid-cols-2 gap-2 content-start">
                    <input type="hidden" name="id" value={a.id} />
                    <label><span className="label">Owner</span>
                      <select name="ownerId" defaultValue={a.ownerId ?? ""} className="field">
                        <option value="">Unassigned</option>
                        {(ownerCache.get(a.dealershipId ?? "group") ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </label>
                    <label><span className="label">Due date</span><input type="date" name="dueDate" defaultValue={a.dueDate ?? ""} min={businessDate()} className="field" /></label>
                    <label><span className="label">Status</span>
                      <select name="status" defaultValue={a.status} className="field">
                        <option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
                      </select>
                    </label>
                    <label className="col-span-2"><span className="label">Action taken / note</span><input name="resolutionNote" defaultValue={a.resolutionNote ?? ""} className="field" placeholder="Required to resolve or dismiss" /></label>
                    <div className="col-span-2"><Submit className="btn-secondary">Update action</Submit></div>
                  </ActionForm>
                ) : (
                  <p className="text-sm text-ink-2">Owner: {ownerName ?? "Unassigned"}{a.dueDate ? `, due ${a.dueDate}` : ""}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-6 text-sm text-ink-2">
        <summary className="cursor-pointer text-petrol">Rule thresholds (defaults to agree with Kun in discovery)</summary>
        <ul className="mt-2 list-disc pl-5 space-y-0.5">
          <li>Revenue below target: warning under {ALERT_THRESHOLDS.revenueBelowTargetWarnPct}% of the approved target, pro-rated to the last completed day; critical under {ALERT_THRESHOLDS.revenueBelowTargetCritPct}%.</li>
          <li>Jobs past promised delivery: warning from 1 job; critical from {ALERT_THRESHOLDS.overdueJobsCritCount}.</li>
          <li>Capacity imbalance: service bay utilisation above {ALERT_THRESHOLDS.utilisationHighPct}% or below {ALERT_THRESHOLDS.utilisationLowPct}% (completed days only).</li>
          <li>Approval wait: jobs waiting more than {ALERT_THRESHOLDS.approvalWaitDays} days for customer or insurer approval.</li>
          <li>Daily report missing: a submitted report is missing for one or more of the last 3 completed days.</li>
        </ul>
      </details>
    </>
  );
}
