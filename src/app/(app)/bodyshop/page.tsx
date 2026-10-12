import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listJobs, getStages } from "@/server/services/jobs";
import { loadDealers } from "@/server/analytics";
import { can, dealershipScope } from "@/domain/permissions";
import { BODYSHOP_COMMON_STAGES, COMMON_STAGE_LABELS } from "@/domain/workflow";
import { first, type SP } from "@/server/period-params";
import { PageHeader, Panel, EmptyState, Chip } from "@/components/ui";
import { DueText, BLOCKER_LABELS } from "@/components/jobs";
import { Icon } from "@/components/Icon";
import { relativeTime } from "@/domain/format";

export const metadata = { title: "Body shop" };

export default async function BodyShopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("jobs.view");
  const sp = await searchParams;
  const db = await getDb();
  const dealers = (await loadDealers(db, dealershipScope(actor))).filter((d) => d.hasBodyShop);
  const dealer = first(sp.dealer) ?? (dealers.length === 1 ? dealers[0].id : undefined);
  const rows = await listJobs(db, actor, { jobType: "bodyshop", dealershipId: dealer });
  // A single location shows its own configured stages; across locations, the common reporting stages.
  const columns = dealer
    ? (await getStages(db, dealer, "bodyshop")).filter((s) => s.commonStage !== "delivered").map((s) => ({ key: s.code, label: s.label, match: (r: (typeof rows)[number]) => r.job.stageCode === s.code }))
    : BODYSHOP_COMMON_STAGES.filter((s) => s !== "delivered").map((s) => ({ key: s, label: COMMON_STAGE_LABELS[s], match: (r: (typeof rows)[number]) => r.job.commonStage === s }));
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Body shop"
        subtitle={`${rows.length} vehicles in progress${dealer ? "" : " across all body shops"}`}
        actions={
          <>
            <Link href="/jobs?type=bodyshop" className="btn-secondary">List view</Link>
            {can(actor, "jobs.create") && <Link href="/jobs/new?type=bodyshop" className="btn-primary"><Icon name="plus" /> New body shop job</Link>}
          </>
        }
      />
      {dealers.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4 text-[13px]">
          <Link href="/bodyshop" className={`chip ${!dealer ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>All body shops</Link>
          {dealers.map((d) => <Link key={d.id} href={`/bodyshop?dealer=${d.id}`} className={`chip ${dealer === d.id ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>{d.name}</Link>)}
        </div>
      )}
      {!dealers.length ? (
        <Panel><EmptyState title="No body shop in your scope" icon="spray" /></Panel>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 snap-x" role="list" aria-label="Body shop stages">
          {columns.map((c) => {
            const items = rows.filter(c.match);
            return (
              <section key={c.key} role="listitem" aria-label={`${c.label}: ${items.length}`} className="snap-start shrink-0 w-[236px] rounded-lg bg-line/40 p-2">
                <h2 className="flex items-center justify-between px-1.5 py-1 text-sm font-semibold">{c.label}<span className="num text-ink-2 font-medium">{items.length}</span></h2>
                <ul className="space-y-2 mt-1">
                  {items.map((r) => (
                    <li key={r.job.id}>
                      <Link href={`/jobs/${r.job.id}`} className="block rounded border border-line bg-panel p-2.5 hover:border-petrol">
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold text-sm">{r.reg}</span>
                          {!dealer && <span className="text-2xs text-ink-3">{r.dealershipCode}</span>}
                        </div>
                        <p className="text-xs text-ink-3">{r.make} {r.model} · {r.job.jobNo}</p>
                        <p className="text-xs text-ink-2 mt-1 line-clamp-2">{r.job.complaint}</p>
                        <div className="mt-2 flex items-end justify-between gap-1">
                          <DueText due={r.job.promisedAt ?? r.job.expectedCompletionAt} status={r.job.status} now={now} />
                          <span className="text-2xs text-ink-3 text-right">in stage {relativeTime(r.job.stageEnteredAt, now).replace(" ago", "")}</span>
                        </div>
                        {(r.job.blocker !== "none" || r.job.approvalStatus === "pending") && (
                          <div className="mt-1.5"><Chip tone="warn">{r.job.blocker !== "none" ? BLOCKER_LABELS[r.job.blocker] : "Approval pending"}</Chip></div>
                        )}
                        <p className="text-2xs text-ink-3 mt-1">{r.assigneeName ?? "Unassigned"}{r.job.team ? ` · ${r.job.team}` : ""}</p>
                      </Link>
                    </li>
                  ))}
                  {!items.length && <li className="text-xs text-ink-3 px-1.5 py-2">Empty</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
