import { DealerName } from "@/components/ui";
import { dealerColors } from "@/server/dealer-colors";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listJobs, jobSummary } from "@/server/services/jobs";
import { Tile } from "@/components/crm/kpi";
import { formatInt, formatPct } from "@/domain/format";
import { loadDealers } from "@/server/analytics";
import { can, dealershipScope } from "@/domain/permissions";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, EmptyState, Chip } from "@/components/ui";
import { StageChip, DueText, BLOCKER_LABELS } from "@/components/jobs";
import { Icon } from "@/components/Icon";
import { relativeTime } from "@/domain/format";

export const metadata = { title: "Service jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("jobs.view");
  const dc = await dealerColors();
  const sp = await searchParams;
  // Technicians see all their assigned work (service + body shop) unless they pick a type.
  const typeParam = first(sp.type);
  const type = typeParam === "bodyshop" ? "bodyshop" : "service";
  const typeFilter = actor.role === "technician" && !typeParam ? undefined : type;
  const status = (first(sp.status) ?? "open") as "open" | "closed" | "cancelled" | "all";
  const dealer = first(sp.dealer);
  const q = first(sp.q);
  const overdue = first(sp.overdue) === "1";
  const blocked = first(sp.blocked) === "1";
  const mine = first(sp.mine) === "1" || actor.role === "technician";
  const db = await getDb();
  const [rows, dealers, k] = await Promise.all([
    listJobs(db, actor, { jobType: typeFilter, status, dealershipId: dealer, q, overdue, blocked, mine }),
    loadDealers(db, dealershipScope(actor)),
    jobSummary(db, actor, { jobType: typeFilter, dealershipId: dealer, mine }),
  ]);
  const now = new Date();
  const link = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = { type, status, dealer, q, overdue: overdue ? "1" : undefined, blocked: blocked ? "1" : undefined, mine: first(sp.mine) };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
    return `/jobs?${p.toString()}`;
  };
  const title = actor.role === "technician" ? "My jobs" : type === "service" ? "Service jobs" : "Body shop jobs";

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${rows.length} ${status === "all" ? "" : status} job${rows.length === 1 ? "" : "s"}${overdue ? ", overdue" : ""}${blocked ? ", blocked" : ""}`}
        actions={
          <>
            {type === "bodyshop" && <Link href="/bodyshop" className="btn-secondary">Stage board</Link>}
            {can(actor, "jobs.create") && <Link href={`/jobs/new?type=${type}`} className="btn-primary"><Icon name="plus" /> New job card</Link>}
          </>
        }
      />

      <dl className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 mb-5" aria-label="Job summary">
        <Tile label="Open jobs" value={formatInt(k.open)} note={`${formatInt(k.openedToday)} opened today`} href={link({ status: "open", overdue: null, blocked: null })} />
        <Tile label="Overdue" value={formatInt(k.overdue)} tone={k.overdue ? "crit" : "good"} note={k.open ? `${formatPct((k.overdue / k.open) * 100)} of open jobs` : undefined} href={link({ status: "open", overdue: "1", blocked: null })} />
        <Tile label="Due today" value={formatInt(k.dueToday)} tone={k.dueToday ? "warn" : undefined} note="Promised later today" />
        <Tile label="Awaiting approval" value={formatInt(k.awaitingApproval)} tone={k.awaitingApproval ? "warn" : undefined} note="Customer or insurer" />
        <Tile label="Blocked" value={formatInt(k.blocked)} tone={k.blocked ? "warn" : undefined} note={`${formatInt(k.waitingParts)} waiting on parts`} href={link({ status: "open", blocked: "1", overdue: null })} />
        <Tile label="Delivered this month" value={formatInt(k.deliveredMtd)} tone="good" note={<>{formatInt(k.deliveredToday)} today · {formatPct(k.onTimePctMtd)} on time{k.avgTatHoursMtd != null ? ` · avg ${k.avgTatHoursMtd < 48 ? `${k.avgTatHoursMtd} h` : `${(k.avgTatHoursMtd / 24).toFixed(1)} d`}` : ""}</>} />
      </dl>

      <form className="flex flex-wrap items-end gap-2 mb-3" action="/jobs">
        <input type="hidden" name="type" value={type} />
        {first(sp.mine) && <input type="hidden" name="mine" value="1" />}
        <label className="flex-1 min-w-[200px]">
          <span className="sr-only">Search</span>
          <input name="q" defaultValue={q ?? ""} placeholder="Search job no, registration or customer" className="field" />
        </label>
        {dealers.length > 1 && (
          <select name="dealer" defaultValue={dealer ?? ""} className="field w-auto" aria-label="Dealership">
            <option value="">All dealerships</option>
            {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <select name="status" defaultValue={status} className="field w-auto" aria-label="Status">
          <option value="open">Open</option>
          <option value="closed">Delivered</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </select>
        <button className="btn-secondary">Apply</button>
      </form>
      <div className="flex flex-wrap gap-2 mb-4 text-[13px]">
        {actor.role === "technician" && <Link href="/jobs" className={`chip ${!typeFilter ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>All my work</Link>}
        <Link href={link({ type: "service" })} className={`chip ${typeFilter === "service" ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>Service</Link>
        <Link href={link({ type: "bodyshop" })} className={`chip ${typeFilter === "bodyshop" ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>Body shop</Link>
        <span className="w-px bg-line mx-1" />
        <Link href={link({ overdue: overdue ? null : "1" })} className={`chip ${overdue ? "bg-crit text-white" : "bg-panel border border-line text-ink-2"}`}>Overdue</Link>
        <Link href={link({ blocked: blocked ? null : "1" })} className={`chip ${blocked ? "bg-warn text-white" : "bg-panel border border-line text-ink-2"}`}>Blocked</Link>
        {actor.role !== "technician" && can(actor, "jobs.manage") && <Link href={link({ mine: first(sp.mine) ? null : "1" })} className={`chip ${first(sp.mine) ? "bg-petrol text-white" : "bg-panel border border-line text-ink-2"}`}>Assigned to me</Link>}
      </div>

      {!rows.length ? (
        <Panel>
          <EmptyState title={q || overdue || blocked ? "No jobs match these filters" : "No jobs yet"} icon="wrench" action={can(actor, "jobs.create") ? <Link href={`/jobs/new?type=${type}`} className="btn-primary">New job card</Link> : undefined}>
            {actor.role === "technician" ? "Jobs assigned to you will appear here." : "Create a job card when a vehicle arrives, or check in an appointment."}
          </EmptyState>
        </Panel>
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li key={r.job.id}>
                <Link href={`/jobs/${r.job.id}`} className="block panel p-3 active:bg-page">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{r.reg}</p>
                      <p className="text-xs text-ink-3">{r.job.jobNo} · {r.make} {r.model}</p>
                    </div>
                    <StageChip common={r.job.commonStage} />
                  </div>
                  <p className="text-sm text-ink-2 mt-1.5 line-clamp-1">{r.job.complaint}</p>
                  <div className="flex items-end justify-between mt-2">
                    <DueText due={r.job.promisedAt ?? r.job.expectedCompletionAt} status={r.job.status} now={now} />
                    {r.job.blocker !== "none" && <Chip tone="warn">{BLOCKER_LABELS[r.job.blocker]}</Chip>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {/* Desktop: table */}
          <Panel className="hidden md:block" bodyClassName="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line">
                  <tr>
                    <th className="th">Job / vehicle</th>
                    {dealers.length > 1 && <th className="th">Dealership</th>}
                    <th className="th">Customer & complaint</th>
                    <th className="th">Stage</th>
                    <th className="th">Assigned</th>
                    <th className="th">Promised</th>
                    <th className="th">Blocker / next action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.job.id} className="border-b border-line last:border-0 hover:bg-page/60">
                      <td className="td">
                        <Link href={`/jobs/${r.job.id}`} className="font-medium text-petrol hover:underline">{r.reg}</Link>
                        <div className="text-xs text-ink-3">{r.job.jobNo}</div>
                      </td>
                      {dealers.length > 1 && <td className="td text-sm whitespace-nowrap"><DealerName name={r.dealershipName} color={dc.of(r.dealershipName)} size="sm" /></td>}
                      <td className="td max-w-[280px]">
                        <div className="text-sm">{r.customerName}</div>
                        <div className="text-xs text-ink-3 line-clamp-1">{r.make} {r.model} · {r.job.complaint}</div>
                      </td>
                      <td className="td"><StageChip common={r.job.commonStage} /><div className="text-xs text-ink-3 mt-0.5">since {relativeTime(r.job.stageEnteredAt, now)}</div></td>
                      <td className="td text-sm">{r.assigneeName ?? <span className="text-ink-3">Unassigned</span>}</td>
                      <td className="td"><DueText due={r.job.promisedAt ?? r.job.expectedCompletionAt} status={r.job.status} now={now} /></td>
                      <td className="td text-sm max-w-[240px]">
                        {r.job.blocker !== "none" && <Chip tone="warn">{BLOCKER_LABELS[r.job.blocker]}</Chip>}
                        {r.job.nextAction && <div className="text-xs text-ink-2 mt-0.5">{r.job.nextAction}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
