import { DealerName } from "@/components/ui";
import { dealerColors } from "@/server/dealer-colors";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCap } from "@/server/auth";
import { listProspects, salesDealerships, groupCatalogue } from "@/server/services/crm";
import { can } from "@/domain/permissions";
import { TIMEFRAME_LABELS, BUDGET_LABELS, UPGRADE_AGE_YEARS, ownershipYears } from "@/domain/crm";
import { businessDate } from "@/domain/periods";
import { formatDate } from "@/domain/format";
import { TIMEFRAMES, BUDGET_BANDS } from "@/db/schema";
import { first, periodFromParams, type SP } from "@/server/period-params";
import { prospectPerformance } from "@/server/services/crm-analytics";
import { periodRangeLabel } from "@/domain/periods";
import { formatInt, formatPct } from "@/domain/format";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { Tile, TileGroup, TallyBars } from "@/components/crm/kpi";
import { Notice } from "@/components/ui";
import { PageHeader, Panel, Chip, EmptyState } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { prospectStatusAction, convertProspectAction } from "../leads/actions";

export const metadata = { title: "Future prospects" };

const INTEREST = { yes: ["Looking now", "good"], maybe: ["Maybe later", "info"], no: ["Not now", "neutral"] } as const;
const LIST_LIMIT = 100;
const STATUS = { new: "New", contacted: "Contacted", converted: "Converted", not_now: "Not now" } as const;

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireCap("prospects.view");
  const dc = await dealerColors();
  const sp = await searchParams;
  const db = await getDb();
  const today = businessDate();
  const status = first(sp.status) as keyof typeof STATUS | "all" | undefined;
  const upgradeOnly = first(sp.upgrade) === "1";
  const filters = {
    upgradeOnly,
    interest: (first(sp.interest) || undefined) as "yes" | "maybe" | "no" | undefined,
    timeframe: first(sp.timeframe) || undefined,
    budgetBand: first(sp.budget) || undefined,
    status: status || undefined,
    modelId: first(sp.model) || undefined,
  };
  const { period, error } = periodFromParams(sp);
  const [rows, dealers, catalogue, k] = await Promise.all([listProspects(db, actor, filters), salesDealerships(db, actor), groupCatalogue(db), prospectPerformance(db, actor, period)]);
  const manage = can(actor, "leads.manage");
  const upgrades = rows.filter((r) => r.upgradeCandidate).length;

  return (
    <>
      <PageHeader
        title="Future prospects"
        subtitle={<>Lounge feedback · {period.label}: {periodRangeLabel(period)} · compared with {period.comparison.label}</>}
        actions={<PeriodSelector current={period.key} start={period.start} end={period.end} today={today} />}
      />
      {error && <div className="mb-4"><Notice tone="warn" title="Showing month to date instead">{error}</Notice></div>}
      <div className="space-y-6 mb-8">
        <TileGroup title="Responses & intent" subtitle="Lounge feedback submitted in the period">
          <Tile label="Lounge responses" value={formatInt(k.responses)} delta={k.responsesGrowthPct} note={k.avgServiceRating != null ? `Service rated ${k.avgServiceRating} / 5 on average` : undefined} />
          <Tile label={`Upgrade due (car ${UPGRADE_AGE_YEARS}+ yrs)`} value={formatInt(k.upgradeDue)} note={`${formatPct(k.upgradeDuePct)} of responses · ${formatInt(k.upgradeAndInterested)} also interested`} tone={k.upgradeDue ? "warn" : undefined} />
          <Tile label="Looking now" value={formatInt(k.interestedNow)} tone={k.interestedNow ? "good" : undefined} note={`${formatInt(k.maybeLater)} maybe later · ${formatInt(k.notNow)} not now`} />
          <Tile label="Ready within 3 months" value={formatInt(k.readyIn3Months)} tone={k.readyIn3Months ? "good" : undefined} note="Looking now, buying in ≤ 3 months" />
          <Tile label="Interested in another brand" value={formatInt(k.crossBrand)} note="Cross-sell within the group" />
          <Tile label="Agreed to offers" value={formatPct(k.consentPct)} note="Of interested respondents" />
        </TileGroup>
        <TileGroup title="Follow-through & nurture" subtitle="What the team did with these prospects" cols={4}>
          <Tile label="Contacted" value={formatPct(k.contactedPct)} note="Interested respondents contacted or converted" />
          <Tile label="Converted to enquiries" value={formatInt(k.convertedToEnquiry)} note={`${formatPct(k.conversionPct)} of interested respondents in the period`} />
          <Tile label="Converted enquiries sold" value={formatInt(k.convertedWon)} tone={k.convertedWon ? "good" : undefined} note="Sales closed in the period" />
          <Tile label="Prospects sent model updates" value={formatInt(k.prospectsMessaged)} href="/leads/updates" />
        </TileGroup>
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Budget" subtitle="Interested respondents"><TallyBars rows={k.budgets} label={(x) => BUDGET_LABELS[x] ?? x} /></Panel>
          <Panel title="When they plan to change"><TallyBars rows={k.timeframes} label={(x) => TIMEFRAME_LABELS[x as keyof typeof TIMEFRAME_LABELS] ?? x} /></Panel>
          <Panel title="Most wanted models"><TallyBars rows={k.topModels} /></Panel>
        </div>
      </div>
      <h2 className="text-[15px] font-semibold mb-1">Prospect list</h2>
      <p className="text-xs text-ink-3 mb-3">{rows.length} customers · {upgrades} own a car {UPGRADE_AGE_YEARS}+ years old{rows.length > LIST_LIMIT ? ` · showing the ${LIST_LIMIT} highest-scoring; narrow with the filters` : ""}. The list is a work queue and uses its own filters, not the period above.</p>
      <form action="/prospects" className="flex flex-wrap items-end gap-2 mb-4">
        {(["period", "from", "to"] as const).map((x) => first(sp[x]) ? <input key={x} type="hidden" name={x} value={first(sp[x])} /> : null)}
        <select name="interest" defaultValue={filters.interest ?? ""} className="field w-auto" aria-label="Interest"><option value="">Any interest</option><option value="yes">Looking now</option><option value="maybe">Maybe later</option><option value="no">Not now</option></select>
        <select name="timeframe" defaultValue={filters.timeframe ?? ""} className="field w-auto" aria-label="Timeframe"><option value="">Any timeframe</option>{TIMEFRAMES.map((t) => <option key={t} value={t}>{TIMEFRAME_LABELS[t]}</option>)}</select>
        <select name="budget" defaultValue={filters.budgetBand ?? ""} className="field w-auto" aria-label="Budget"><option value="">Any budget</option>{BUDGET_BANDS.map((b) => <option key={b} value={b}>{BUDGET_LABELS[b]}</option>)}</select>
        <select name="model" defaultValue={filters.modelId ?? ""} className="field w-auto" aria-label="Model liked"><option value="">Any model</option>{catalogue.map((x) => <option key={x.m.id} value={x.m.id}>{x.brand} {x.m.name}</option>)}</select>
        <select name="status" defaultValue={status ?? ""} className="field w-auto" aria-label="Status"><option value="">New + contacted</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="all">All</option></select>
        <label className="flex items-center gap-1.5 text-sm h-10"><input type="checkbox" name="upgrade" value="1" defaultChecked={upgradeOnly} /> Car {UPGRADE_AGE_YEARS}+ years old</label>
        <button className="btn-secondary">Apply</button>
        {["interest", "timeframe", "budget", "model", "status", "upgrade"].some((x) => first(sp[x])) && <Link href={`/prospects${first(sp.period) ? `?period=${first(sp.period)}${first(sp.from) ? `&from=${first(sp.from)}&to=${first(sp.to)}` : ""}` : ""}`} className="btn-ghost">Clear</Link>}
      </form>
      <Panel bodyClassName="px-0 pb-0">
        {!rows.length ? <EmptyState title="No prospects match" icon="spark">Customers fill in the lounge kiosk while they wait for their car.</EmptyState> : (
          <ul className="divide-y divide-line">
            {rows.slice(0, LIST_LIMIT).map((r) => {
              const yrs = ownershipYears(r.f.purchaseYear, today);
              const [il, it] = INTEREST[r.f.interest];
              return (
                <li key={r.f.id} className="px-4 py-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.customerName}</span>
                      {r.phone && <a href={`tel:${r.phone}`} className="text-sm text-petrol">{r.phone}</a>}
                      <Chip tone={it}>{il}</Chip>
                      {r.upgradeCandidate && <Chip tone="warn">Upgrade due · {yrs} yrs</Chip>}
                      {r.f.status !== "new" && <Chip tone={r.f.status === "converted" ? "good" : "neutral"}>{STATUS[r.f.status]}</Chip>}
                      {!r.canNurture && <Chip tone="neutral" title="No marketing consent or opted out">No offers consent</Chip>}
                    </div>
                    <p className="text-sm text-ink-2 mt-1">
                      Drives {[r.f.currentMake, r.f.currentModel].filter(Boolean).join(" ") || "—"}{r.f.purchaseYear ? ` (bought ${r.f.purchaseYear}${!r.upgradeCandidate && yrs != null ? `, ${yrs} yrs` : ""})` : ""}
                      {r.f.timeframe && ` · change ${TIMEFRAME_LABELS[r.f.timeframe].toLowerCase()}`}
                      {r.f.budgetBand && ` · ${BUDGET_LABELS[r.f.budgetBand]}`}
                      {[r.f.preferredBodyType, r.f.preferredFuel].filter(Boolean).length > 0 && ` · prefers ${[r.f.preferredBodyType, r.f.preferredFuel].filter(Boolean).join(", ")}`}
                    </p>
                    {r.preferredModels.length > 0 && <p className="text-sm mt-0.5">Likes: {r.preferredModels.map((m) => `${m.brand} ${m.name}`).join(", ")}</p>}
                    {r.f.otherPreferences && <p className="text-sm text-ink-2 mt-0.5">“{r.f.otherPreferences}”</p>}
                    <p className="text-xs text-ink-3 mt-1"><DealerName name={`${r.dealershipName} lounge`} color={dc.of(r.dealershipName)} size="sm" /> · {formatDate(r.f.createdAt)}{r.f.serviceRating ? ` · rated today’s service ${"★".repeat(r.f.serviceRating)}` : ""}</p>
                  </div>
                  {manage && r.f.status !== "converted" && (
                    <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                      {dealers.length > 0 && (
                        <ActionForm action={convertProspectAction} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={r.f.id} />
                          <select name="dealershipId" className="field h-8 w-auto text-[13px]" aria-label="Dealership for the enquiry" defaultValue={dealers.find((d) => r.preferredModels.some((m) => catalogue.find((x) => x.m.id === m.id)?.m.brandId === d.brandId))?.id ?? dealers[0].id}>
                            {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          <Submit className="btn-primary btn-sm" pendingText="…">Create enquiry</Submit>
                        </ActionForm>
                      )}
                      {r.f.status !== "contacted" && <ActionForm action={prospectStatusAction}><input type="hidden" name="id" value={r.f.id} /><Submit className="btn-secondary btn-sm" name="status" value="contacted">Contacted</Submit></ActionForm>}
                      {r.f.status !== "not_now" && <ActionForm action={prospectStatusAction}><input type="hidden" name="id" value={r.f.id} /><Submit className="btn-ghost btn-sm" name="status" value="not_now">Not now</Submit></ActionForm>}
                    </div>
                  )}
                  {r.f.status === "converted" && r.f.convertedLeadId && <Link href={`/leads/${r.f.convertedLeadId}`} className="btn-secondary btn-sm self-start">Open enquiry</Link>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
