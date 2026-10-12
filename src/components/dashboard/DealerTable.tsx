"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { formatInrCompact, formatPct, formatInt } from "@/domain/format";

export interface DealerTableRow {
  id: string;
  name: string;
  brand: string;
  entity: string;
  location: string;
  revenue: number;
  revenueGrowth: number | null;
  targetPct: number | null;
  gpMargin: number | null;
  gpStatus: "complete" | "provisional" | "insufficient" | "no_revenue";
  delivered: number;
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

type Key = "name" | "revenue" | "targetPct" | "gpMargin" | "delivered" | "serviceOpen" | "utilisation" | "bodyWip" | "signal";
const SIGNAL_RANK = { critical: 4, warning: 3, info: 1, ok: 1, no_data: 0 };

export function DealerTable({ rows, query, showFinancials = true }: { rows: DealerTableRow[]; query: string; showFinancials?: boolean }) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "revenue", dir: -1 });
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const sorted = useMemo(() => {
    const val = (r: DealerTableRow) => (sort.key === "signal" ? SIGNAL_RANK[r.signal] : r[sort.key]);
    return [...rows]
      .filter((r) => filter === "all" || r.signal === "critical" || r.signal === "warning" || r.stale)
      .sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
      });
  }, [rows, sort, filter]);

  const H = ({ k, children, right }: { k: Key; children: React.ReactNode; right?: boolean }) => (
    <th className={clsx("th", right && "text-right")} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className={clsx("inline-flex items-center gap-1 hover:text-ink", right && "flex-row-reverse")} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === "name" ? 1 : -1 }))}>
        {children}
        <span aria-hidden className="text-ink-3 text-[10px]">{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div role="group" aria-label="Filter dealerships" className="inline-flex rounded border border-line-strong p-0.5 text-[13px]">
          {(["all", "attention"] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={clsx("px-2.5 h-7 rounded-sm", filter === f ? "bg-ink text-white" : "text-ink-2")}>
              {f === "all" ? `All (${rows.length})` : "Needs attention"}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full min-w-[920px] border-collapse">
          <thead className="border-b border-line">
            <tr>
              <H k="name">Dealership / entity</H>
              {showFinancials && <H k="revenue" right>Revenue</H>}
              {showFinancials && <H k="targetPct" right>vs target</H>}
              {showFinancials && <H k="gpMargin" right>GP margin</H>}
              <H k="delivered" right>Vehicles delivered</H>
              <H k="serviceOpen" right>Service open / overdue</H>
              <H k="utilisation" right>Bay utilisation</H>
              <H k="bodyWip" right>Body shop WIP / overdue</H>
              <H k="signal">Management signal</H>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 hover:bg-page/60">
                <td className="td">
                  <Link href={`/dealerships/${r.id}?${query}`} className="font-medium text-petrol hover:underline">{r.name}</Link>
                  <div className="text-xs text-ink-3 whitespace-nowrap">{r.entity}</div><div className="text-xs text-ink-3 whitespace-nowrap">{r.location}</div>
                </td>
                {showFinancials && (
                  <td className="td text-right num">
                    {formatInrCompact(r.revenue)}
                    {r.revenueGrowth != null && <div className={clsx("text-xs", r.revenueGrowth >= 0 ? "text-good" : "text-crit")}>{r.revenueGrowth >= 0 ? "▲" : "▼"} {Math.abs(r.revenueGrowth).toFixed(1)}%</div>}
                  </td>
                )}
                {showFinancials && (
                  <td className="td text-right num">
                    {r.targetPct == null ? <span className="text-xs text-ink-3">No approved target</span> : <span className={clsx(r.targetPct < 90 ? "text-crit" : r.targetPct < 100 ? "text-warn" : "text-good", "font-medium")}>{formatPct(r.targetPct)}</span>}
                  </td>
                )}
                {showFinancials && (
                  <td className="td text-right num">
                    {r.gpStatus === "insufficient" ? <span className="text-xs text-ink-3" title="Direct cost known for too little revenue">Cost data incomplete</span> : r.gpStatus === "no_revenue" ? "—" : (
                      <>
                        {formatPct(r.gpMargin)}
                        {r.gpStatus === "provisional" && <div className="text-xs text-warn">Provisional</div>}
                      </>
                    )}
                  </td>
                )}
                <td className="td text-right num">{formatInt(r.delivered)}</td>
                <td className="td text-right num">
                  {formatInt(r.serviceOpen)} <span className="text-ink-3">/</span> <span className={clsx(r.serviceOverdue > 0 && "text-crit font-medium")}>{formatInt(r.serviceOverdue)}</span>
                </td>
                <td className="td text-right num">{formatPct(r.utilisation)}</td>
                <td className="td text-right num">
                  {r.bodyWip == null ? <span className="text-xs text-ink-3">No body shop</span> : (<>{formatInt(r.bodyWip)} <span className="text-ink-3">/</span> <span className={clsx((r.bodyOverdue ?? 0) > 0 && "text-crit font-medium")}>{formatInt(r.bodyOverdue)}</span></>)}
                </td>
                <td className="td">
                  <SignalCell r={r} />
                </td>
              </tr>
            ))}
            {!sorted.length && (
              <tr><td className="td text-center text-ink-2 py-8" colSpan={9}>No dealerships need attention for this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SignalCell({ r }: { r: DealerTableRow }) {
  const tone = r.signal === "critical" ? "bg-crit-soft text-crit" : r.signal === "warning" ? "bg-warn-soft text-warn" : r.signal === "no_data" ? "bg-page text-ink-2 border border-line" : "bg-good-soft text-good";
  const label = r.signal === "critical" ? "Critical" : r.signal === "warning" ? "Warning" : r.signal === "no_data" ? "No data" : "On track";
  return (
    <div className="max-w-[240px]">
      <span className={clsx("chip", tone)}>{label}{r.alertCount > 0 && ` · ${r.alertCount}`}</span>
      {r.stale && <span className="chip bg-warn-soft text-warn ml-1">Stale data</span>}
      {r.topAlert && <p className="text-xs text-ink-2 mt-1 line-clamp-2">{r.topAlert}</p>}
    </div>
  );
}
