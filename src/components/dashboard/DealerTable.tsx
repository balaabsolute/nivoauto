"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { formatInrCompact, formatPct, formatInt } from "@/domain/format";
import { DealerName } from "@/components/ui";

export interface DealerTableRow {
  id: string;
  name: string;
  color: string;
  brand: string;
  entity: string;
  location: string;
  revenue: number;
  revenueGrowth: number | null;
  targetPct: number | null;
  delivered: number;
  deliveredPct: number | null;
  serviceOpen: number;
  serviceOverdue: number;
  utilisation: number | null;
  bodyWip: number | null; // null = no body shop
  bodyOverdue: number | null;
  signal: "critical" | "warning" | "info" | "ok" | "no_data";
  alertCount: number;
  stale: boolean;
  topAlert: string | null;
}

type Key = "revenue" | "targetPct" | "delivered" | "serviceOverdue" | "utilisation" | "signal" | "name";
const SORTS: { k: Key; l: string; fin?: boolean }[] = [
  { k: "targetPct", l: "Target achievement", fin: true },
  { k: "revenue", l: "Revenue", fin: true },
  { k: "delivered", l: "Vehicles delivered" },
  { k: "serviceOverdue", l: "Overdue jobs" },
  { k: "utilisation", l: "Bay utilisation" },
  { k: "signal", l: "Needs attention first" },
  { k: "name", l: "Name" },
];
const SIGNAL_RANK = { critical: 4, warning: 3, info: 1, ok: 1, no_data: 0 };
const tone = (p: number | null) => (p == null ? "text-ink-3" : p >= 100 ? "text-good" : p >= 90 ? "text-warn" : "text-crit");
const bar = (p: number | null) => (p == null ? "bg-line" : p >= 100 ? "bg-good" : p >= 90 ? "bg-warn" : "bg-crit");

/** Dealership comparison as cards (sortable, filterable). Named DealerTable for existing imports. */
export function DealerTable({ rows, query, showFinancials = true }: { rows: DealerTableRow[]; query: string; showFinancials?: boolean }) {
  const [sort, setSort] = useState<Key>(showFinancials ? "targetPct" : "delivered");
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const sorted = useMemo(() => {
    const val = (r: DealerTableRow) => (sort === "signal" ? SIGNAL_RANK[r.signal] : r[sort]);
    return [...rows]
      .filter((r) => filter === "all" || r.signal === "critical" || r.signal === "warning" || r.stale)
      .sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return typeof va === "string" ? va.localeCompare(vb as string) : (vb as number) - (va as number);
      });
  }, [rows, sort, filter]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div role="group" aria-label="Filter dealerships" className="inline-flex rounded border border-line-strong p-0.5 text-[13px]">
          {(["all", "attention"] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={clsx("px-2.5 h-7 rounded-sm", filter === f ? "bg-ink text-white" : "text-ink-2")}>
              {f === "all" ? `All (${rows.length})` : "Needs attention"}
            </button>
          ))}
        </div>
        <label className="text-[13px] text-ink-2 flex items-center gap-1.5 ml-auto">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as Key)} className="field h-8 w-auto text-[13px]">
            {SORTS.filter((s) => showFinancials || !s.fin).map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}
          </select>
        </label>
      </div>
      {!sorted.length ? (
        <p className="text-center text-ink-2 py-8 text-sm">No dealerships need attention for this period.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((r) => <DealerCard key={r.id} r={r} query={query} showFinancials={showFinancials} />)}
        </ul>
      )}
    </div>
  );
}

function DealerCard({ r, query, showFinancials }: { r: DealerTableRow; query: string; showFinancials: boolean }) {
  const attention = r.signal === "critical" ? "border-t-crit" : r.signal === "warning" ? "border-t-warn" : r.signal === "no_data" ? "border-t-line-strong" : "border-t-good";
  return (
    <li>
      <Link href={`/dealerships/${r.id}?${query}`} className={clsx("block h-full rounded-lg border border-line border-t-4 bg-panel p-4 hover:border-petrol/40 hover:shadow-sm transition", attention)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-ink"><DealerName name={r.name} color={r.color} /></p>
            <p className="text-xs text-ink-3 truncate">{r.entity} · {r.location}</p>
          </div>
          <SignalChip r={r} />
        </div>

        {showFinancials && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[22px] font-semibold num leading-none">{formatInrCompact(r.revenue)}</span>
              {r.revenueGrowth != null && <span className={clsx("text-xs num", r.revenueGrowth >= 0 ? "text-good" : "text-crit")}>{r.revenueGrowth >= 0 ? "▲" : "▼"} {Math.abs(r.revenueGrowth).toFixed(1)}%</span>}
            </div>
            <Meter label="Revenue vs target" pct={r.targetPct} />
          </div>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-ink-2">Vehicles delivered</dt>
            <dd className="num font-medium">{formatInt(r.delivered)} {r.deliveredPct != null && <span className={clsx("text-xs", tone(r.deliveredPct))}>· {formatPct(r.deliveredPct)}</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">Service open / overdue</dt>
            <dd className="num font-medium">{formatInt(r.serviceOpen)} <span className="text-ink-3">/</span> <span className={clsx(r.serviceOverdue > 0 && "text-crit")}>{formatInt(r.serviceOverdue)}</span></dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">Bay utilisation</dt>
            <dd className="num font-medium">{formatPct(r.utilisation)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">Body shop WIP / overdue</dt>
            <dd className="num font-medium">{r.bodyWip == null ? <span className="text-xs text-ink-3 font-normal">No body shop</span> : <>{formatInt(r.bodyWip)} <span className="text-ink-3">/</span> <span className={clsx((r.bodyOverdue ?? 0) > 0 && "text-crit")}>{formatInt(r.bodyOverdue)}</span></>}</dd>
          </div>
        </dl>
        {r.topAlert && <p className="mt-3 border-t border-line pt-2 text-xs text-ink-2 line-clamp-2">{r.topAlert}</p>}
      </Link>
    </li>
  );
}

function Meter({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full bg-line" role="meter" aria-label={label} aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <div className={clsx("h-full rounded-full", bar(pct))} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
      <p className={clsx("mt-1 text-xs", tone(pct))}>{pct == null ? "No approved target" : `${formatPct(pct)} of target`}</p>
    </div>
  );
}

function SignalChip({ r }: { r: DealerTableRow }) {
  const t = r.signal === "critical" ? "bg-crit-soft text-crit" : r.signal === "warning" ? "bg-warn-soft text-warn" : r.signal === "no_data" ? "bg-page text-ink-2 border border-line" : "bg-good-soft text-good";
  const label = r.signal === "critical" ? "Critical" : r.signal === "warning" ? "Warning" : r.signal === "no_data" ? "No data" : "On track";
  return (
    <span className="flex flex-col items-end gap-1 shrink-0">
      <span className={clsx("chip", t)}>{label}{r.alertCount > 0 && ` · ${r.alertCount}`}</span>
      {r.stale && <span className="chip bg-warn-soft text-warn">Stale data</span>}
    </span>
  );
}
