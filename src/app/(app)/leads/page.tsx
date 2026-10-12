import Link from "next/link";
import clsx from "clsx";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listLeads, myFollowUps, salesDealerships, consultantOptions } from "@/server/services/crm";
import { can } from "@/domain/permissions";
import { STAGE_LABELS, STATUS_LABELS, TIMEFRAME_LABELS } from "@/domain/crm";
import { formatDateTime, relativeTime } from "@/domain/format";
import { first, type SP } from "@/server/period-params";
import { LEAD_STAGES, LEAD_STATUSES, type LeadStatus, type LeadStage } from "@/db/schema";
import { PageHeader, Panel, Chip, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { LeadTabs } from "./LeadTabs";

export const metadata = { title: "Car enquiries" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("leads.view");
  const sp = await searchParams;
  const db = await getDb();
  const view = first(sp.view) === "followups" ? "followups" : "list";
  const canPublish = can(actor, "model_updates.manage");
  const newBtn = can(actor, "leads.manage") ? <Link href="/leads/new" className="btn-primary"><Icon name="plus" /> New enquiry</Link> : null;

  if (view === "followups") {
    const fus = await myFollowUps(db, actor, { includeFuture: first(sp.all) === "1" });
    const now = new Date();
    return (
      <>
        <PageHeader title="Car enquiries" subtitle={actor.role === "sales_consultant" ? "Your follow-ups due today or overdue" : "Follow-ups due across your dealerships"} actions={newBtn} />
        <LeadTabs current="followups" canPublish={canPublish} />
        <div className="mb-3 text-sm"><Link href={first(sp.all) === "1" ? "/leads?view=followups" : "/leads?view=followups&all=1"} className="text-petrol hover:underline">{first(sp.all) === "1" ? "Show only due" : "Include upcoming"}</Link></div>
        <Panel bodyClassName="px-0 pb-0">
          {!fus.length ? <EmptyState title="Nothing due" icon="check">New follow-ups appear when enquiries are captured, after test drives, and when model updates go out.</EmptyState> : (
            <ul className="divide-y divide-line">
              {fus.map((r) => (
                <li key={r.f.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Link href={`/leads/${r.leadId}`} className="font-medium text-petrol hover:underline">{r.customerName}</Link>
                    <span className="text-xs text-ink-3 ml-2">{r.leadNo}</span>
                    <p className="text-sm text-ink-2">{r.f.kind === "call" ? "Call" : r.f.kind === "visit" ? "Visit" : "Message"}: {r.f.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className={clsx("text-sm", r.f.dueAt < now ? "text-crit font-medium" : "text-ink")}>{formatDateTime(r.f.dueAt)}</p>
                    {actor.role !== "sales_consultant" && <p className="text-xs text-ink-3">{r.assignee ?? "Unassigned"}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </>
    );
  }

  const status = (first(sp.status) ?? "open") as LeadStatus | "all";
  const stage = first(sp.stage) as LeadStage | undefined;
  const dealers = await salesDealerships(db, actor);
  const dealer = first(sp.dealer);
  const consultants = dealer ? await consultantOptions(db, dealer) : dealers.length === 1 ? await consultantOptions(db, dealers[0].id) : [];
  const consultant = first(sp.consultant) ?? (actor.role === "sales_consultant" && first(sp.team) !== "1" ? actor.id : undefined);
  const rows = await listLeads(db, actor, { status, stage, dealershipId: dealer, consultantId: consultant, q: first(sp.q), due: first(sp.due) === "1" });
  const now = new Date();

  return (
    <>
      <PageHeader title="Car enquiries" subtitle={`${rows.length} ${status === "all" ? "" : STATUS_LABELS[status as LeadStatus]?.toLowerCase() ?? ""} enquiries${actor.role === "sales_consultant" && consultant === actor.id ? " assigned to you" : ""}`} actions={newBtn} />
      <LeadTabs current="list" canPublish={canPublish} />
      <form action="/leads" className="flex flex-wrap items-end gap-2 mb-4">
        <input name="q" defaultValue={first(sp.q) ?? ""} placeholder="Search name, mobile or enquiry no" className="field flex-1 min-w-[200px]" aria-label="Search" />
        {dealers.length > 1 && <select name="dealer" defaultValue={dealer ?? ""} className="field w-auto" aria-label="Dealership"><option value="">All dealerships</option>{dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        <select name="status" defaultValue={status} className="field w-auto" aria-label="Status">{[...LEAD_STATUSES, "all" as const].map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : STATUS_LABELS[s]}</option>)}</select>
        <select name="stage" defaultValue={stage ?? ""} className="field w-auto" aria-label="Stage"><option value="">All stages</option>{LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
        {consultants.length > 0 && (
          <select name="consultant" defaultValue={consultant ?? ""} className="field w-auto" aria-label="Consultant">
            <option value="">Everyone</option><option value="unassigned">Unassigned</option>
            {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {actor.role === "sales_consultant" && <input type="hidden" name="team" value={consultant === actor.id ? "" : "1"} />}
        <label className="flex items-center gap-1.5 text-sm h-10"><input type="checkbox" name="due" value="1" defaultChecked={first(sp.due) === "1"} /> Follow-up due</label>
        <button className="btn-secondary">Apply</button>
      </form>
      {actor.role === "sales_consultant" && (
        <p className="text-sm mb-3"><Link href={consultant === actor.id ? "/leads?team=1" : "/leads"} className="text-petrol hover:underline">{consultant === actor.id ? "Show the whole showroom’s enquiries" : "Show only mine"}</Link></p>
      )}
      <Panel bodyClassName="px-0 pb-0">
        {!rows.length ? <EmptyState title="No enquiries match" icon="car">Walk-ins from the showroom kiosk appear here automatically.</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b border-line"><tr><th className="th">Customer</th><th className="th">Interested in</th><th className="th">Stage</th><th className="th">Timeframe</th><th className="th">Consultant</th><th className="th">Next follow-up</th><th className="th">Created</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const due = r.l.nextFollowUpAt;
                  return (
                    <tr key={r.l.id} className="border-b border-line last:border-0 hover:bg-page/60">
                      <td className="td">
                        <Link href={`/leads/${r.l.id}`} className="font-medium text-petrol hover:underline">{r.customerName}</Link>
                        <div className="text-xs text-ink-3">{r.l.leadNo}{dealers.length > 1 ? ` · ${r.dealershipName}` : ""}</div>
                      </td>
                      <td className="td">{r.models.join(", ") || "—"}{r.testDrive && <div className="text-xs text-ink-3">Test drive {r.testDrive}</div>}</td>
                      <td className="td">{r.l.status === "open" ? <Chip tone="petrol">{STAGE_LABELS[r.l.stage]}</Chip> : <Chip tone={r.l.status === "won" ? "good" : "neutral"}>{STATUS_LABELS[r.l.status]}</Chip>}</td>
                      <td className="td text-ink-2">{r.l.timeframe ? TIMEFRAME_LABELS[r.l.timeframe] : "—"}</td>
                      <td className="td">{r.consultantName ?? <span className="text-warn">Unassigned</span>}</td>
                      <td className={clsx("td", r.l.status === "open" && due && due < now ? "text-crit font-medium" : "")}>{r.l.status === "open" ? (due ? formatDateTime(due) : <span className="text-warn">Not set</span>) : "—"}</td>
                      <td className="td text-xs text-ink-3">{relativeTime(r.l.createdAt, now)} · {r.l.source.replace("_", " ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
