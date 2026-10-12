import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { salesPerformance } from "@/server/services/crm-analytics";
import { salesDealerships } from "@/server/services/crm";
import { can } from "@/domain/permissions";
import { businessDate, periodRangeLabel } from "@/domain/periods";
import { formatInt, formatPct } from "@/domain/format";
import { first, periodFromParams, type SP } from "@/server/period-params";
import { PageHeader, Panel, Notice, EmptyState } from "@/components/ui";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { Tile, TileGroup, TallyBars, OutcomeBar } from "@/components/crm/kpi";
import { LeadTabs } from "../LeadTabs";

export const metadata = { title: "Sales performance" };

const SOURCE: Record<string, string> = { walk_in: "Showroom walk-in", phone: "Phone", web: "Website", lounge_feedback: "Lounge prospect", referral: "Referral", other: "Other" };
const hours = (h: number | null) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);

export default async function PerformancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("leads.view");
  const sp = await searchParams;
  const { period, error } = periodFromParams(sp);
  const db = await getDb();
  const dealers = await salesDealerships(db, actor);
  const dealer = first(sp.dealer) || null;
  const k = await salesPerformance(db, actor, period, dealer);
  const today = businessDate();
  const qs = (id: string | null) => {
    const p = new URLSearchParams();
    for (const [key, val] of Object.entries(sp)) if (key !== "dealer" && typeof val === "string") p.set(key, val);
    if (id) p.set("dealer", id);
    return `/leads/performance?${p.toString()}`;
  };
  const p = k.pipeline;
  const n = k.nurture;

  return (
    <>
      <PageHeader
        title="Car enquiries"
        subtitle={<>{period.label}: {periodRangeLabel(period)}{period.end === today && " (today in progress)"} · compared with {period.comparison.label}</>}
        actions={<PeriodSelector current={period.key} start={period.start} end={period.end} today={today} />}
      />
      <LeadTabs current="performance" canPublish={can(actor, "model_updates.manage")} />
      {error && <div className="mb-4"><Notice tone="warn" title="Showing month to date instead">{error}</Notice></div>}
      {dealers.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4 text-[13px]">
          <Link href={qs(null)} className={`chip ${!dealer ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>All dealerships</Link>
          {dealers.map((d) => <Link key={d.id} href={qs(d.id)} className={`chip ${dealer === d.id ? "bg-ink text-white" : "bg-panel border border-line text-ink-2"}`}>{d.name}</Link>)}
        </div>
      )}

      <div className="space-y-6">
        <TileGroup title="Sales" subtitle="Enquiries created, test drives completed and outcomes recorded in the period">
          <Tile label="New enquiries" value={formatInt(k.enquiries)} delta={k.enquiriesGrowthPct} note={k.bySource[0] ? `Most from ${SOURCE[k.bySource[0].key] ?? k.bySource[0].key}` : undefined} />
          <Tile label="Test drives completed" value={formatInt(k.testDrives)} delta={k.testDrivesGrowthPct} note={`Test-drive rate ${formatPct(k.testDriveRatePct)}`} />
          <Tile label="Cars sold (won)" value={formatInt(k.won)} delta={k.wonGrowthPct} tone={k.won ? "good" : undefined} />
          <Tile label="Close rate" value={formatPct(k.closeRatePct)} note={`${formatInt(k.won)} won of ${formatInt(k.closed)} closed`} />
          <Tile label="Lost to competition" value={formatInt(k.lostOtherDealer)} tone={k.lostOtherDealer ? "warn" : undefined} note={k.lostBrands[0] ? `${formatPct(k.lostToCompetitionPct)} of closed · most to ${k.lostBrands[0].key}` : `${formatPct(k.lostToCompetitionPct)} of closed`} />
          <Tile label="Median days to sale" value={k.medianDaysToWin == null ? "—" : `${k.medianDaysToWin} d`} note="Enquiry created → sold" />
        </TileGroup>

        <TileGroup title="Pipeline now" subtitle="Open enquiries as of now (or the period end)" cols={5}>
          <Tile label="Open enquiries" value={formatInt(p.openNow)} note={`${formatInt(p.openAtEnd)} open at period end`} href="/leads" />
          <Tile label="Hot (buying within a month)" value={formatInt(p.hot)} tone={p.hot ? "good" : undefined} />
          <Tile label="Unassigned" value={formatInt(p.unassigned)} tone={p.unassigned ? "warn" : undefined} href="/leads?consultant=unassigned" />
          <Tile label="Follow-ups overdue" value={formatInt(p.overdueFollowUps)} tone={p.overdueFollowUps ? "crit" : "good"} href="/leads?view=followups" />
          <Tile label="No follow-up planned" value={formatInt(p.noFollowUpPlanned)} tone={p.noFollowUpPlanned ? "warn" : undefined} note="Open enquiries with no open task" />
        </TileGroup>

        <TileGroup title="Nurture" subtitle="How customers were kept warm: model updates, follow-ups and contacts in the period">
          <Tile label="Model updates published" value={formatInt(n.updatesPublished)} href="/leads/updates" />
          <Tile label="Customers reached" value={formatInt(n.enquiriesReached)} note={`${formatInt(n.messagesSent)} messages sent${n.messagesSkippedOrFailed ? ` · ${formatInt(n.messagesSkippedOrFailed)} not delivered` : ""}`} />
          <Tile label="Engaged after an update" value={formatPct(n.engagedAfterPct)} note={`${formatInt(n.engagedAfter)} contacted, test-drove or bought afterwards · ${formatInt(n.wonAfter)} sold`} />
          <Tile label="Follow-ups completed" value={formatPct(k.followUps.completionPct)} tone={k.followUps.completionPct == null ? undefined : k.followUps.completionPct >= 80 ? "good" : k.followUps.completionPct >= 60 ? "warn" : "crit"} note={`${formatInt(k.followUps.done)} of ${formatInt(k.followUps.due)} due · ${formatPct(k.followUps.onTimePct)} on time`} />
          <Tile label="Contacted within 24 h" value={formatPct(k.contactedWithin24hPct)} note={`Median first contact ${hours(k.medianHoursToFirstContact)}`} />
          <Tile label="Opt-outs" value={formatInt(n.optOuts)} tone={n.optOuts ? "warn" : undefined} note={`${formatPct(n.eligibleNowPct)} of open enquiries can receive updates`} />
        </TileGroup>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Outcomes" subtitle="Enquiries closed in the period">
            <OutcomeBar parts={[
              { label: "Sold", n: k.won, className: "bg-good" },
              { label: "Bought elsewhere", n: k.lostOtherDealer, className: "bg-warn" },
              { label: "Not interested", n: k.notInterested, className: "bg-ink-3" },
              { label: "Opted out", n: k.optedOut, className: "bg-crit" },
            ]} />
          </Panel>
          <Panel title="Lost to" subtitle="Where customers bought instead">
            <TallyBars rows={k.lostBrands.slice(0, 6)} empty="No losses to other dealers in this period" />
          </Panel>
          <Panel title="Where enquiries came from">
            <TallyBars rows={k.bySource} label={(x) => SOURCE[x] ?? x} />
          </Panel>
        </div>

        <div className="grid gap-4">
          <Panel title="Sales consultants" subtitle="Activity and results in the period" bodyClassName="px-0 pb-0">
            {!k.consultants.length ? <EmptyState title="No consultant activity in this period" icon="users" /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b border-line"><tr>
                    <th className="th">Consultant</th><th className="th text-right">Enquiries</th><th className="th text-right">Test drives</th><th className="th text-right">Sold</th><th className="th text-right">Close rate</th>
                    <th className="th text-right">Follow-ups done</th><th className="th text-right">Contacts</th><th className="th text-right">Open / overdue now</th>
                  </tr></thead>
                  <tbody>
                    {k.consultants.map((c) => (
                      <tr key={c.id} className="border-b border-line last:border-0">
                        <td className="td font-medium">{c.name}</td>
                        <td className="td text-right num">{formatInt(c.enquiries)}</td>
                        <td className="td text-right num">{formatInt(c.testDrives)}</td>
                        <td className="td text-right num font-medium">{formatInt(c.won)}</td>
                        <td className="td text-right num">{formatPct(c.closeRatePct)}</td>
                        <td className="td text-right num">{formatPct(c.followUpsDonePct)} <span className="text-xs text-ink-3">of {c.followUpsDue}</span></td>
                        <td className="td text-right num">{formatInt(c.contacts)}</td>
                        <td className="td text-right num">{formatInt(c.openNow)} / <span className={c.overdueNow ? "text-crit font-medium" : ""}>{formatInt(c.overdueNow)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="Models" subtitle="Interest, test drives and sales by model" bodyClassName="px-0 pb-0">
            {!k.models.length ? <EmptyState title="No model activity in this period" icon="car" /> : (
              <table className="w-full text-sm">
                <thead className="border-b border-line"><tr><th className="th">Model</th><th className="th text-right">Enquiries</th><th className="th text-right">Test drives</th><th className="th text-right">Test-drive share</th><th className="th text-right">Sold</th></tr></thead>
                <tbody>
                  {k.models.slice(0, 15).map((m) => (
                    <tr key={m.model} className="border-b border-line last:border-0">
                      <td className="td">{m.model}</td><td className="td text-right num">{formatInt(m.enquiries)}</td><td className="td text-right num">{formatInt(m.drives)}</td><td className="td text-right num">{m.enquiries ? formatPct((m.drives / m.enquiries) * 100) : "—"}</td><td className="td text-right num font-medium">{formatInt(m.won)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <p className="text-xs text-ink-3">Definitions: docs/KPI_DEFINITIONS.md §8b. “Engaged after an update” counts enquiries with a call, visit, message, test drive or sale recorded after they received a model update.</p>
      </div>
    </>
  );
}
