import { formatInrCompact, formatPct } from "@/domain/format";

export interface MixRow { key: string; label: string; revenue: number; gpStatus: string; margin: number | null }

/** Revenue mix as labelled horizontal bars — one measure, one hue, values printed. */
export function MixBars({ rows, total }: { rows: MixRow[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const share = total > 0 ? (r.revenue / total) * 100 : 0;
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{r.label}</span>
              <span className="num font-medium">{formatInrCompact(r.revenue)} <span className="text-ink-3 font-normal text-xs">{share.toFixed(0)}%</span></span>
            </div>
            <div className="mt-1 h-2 rounded-r bg-line/60">
              <div className="h-full rounded-r" style={{ width: `${Math.max(0, (r.revenue / max) * 100)}%`, background: "#2a78d6" }} />
            </div>
            <p className="text-xs text-ink-3 mt-0.5">
              {r.gpStatus === "complete" || r.gpStatus === "provisional" ? <>GP margin {formatPct(r.margin)}{r.gpStatus === "provisional" && <span className="text-warn"> (provisional)</span>}</> : r.gpStatus === "insufficient" ? "GP withheld — cost data incomplete" : "No revenue in period"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
