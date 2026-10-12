"use client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { formatInrCompact, formatInr } from "@/domain/format";

export interface TrendPoint { label: string; key: string; current: number | null; comparison: number | null; target: number | null }

const C = { current: "#2a78d6", comparison: "#8a959e", target: "#14212b" };

export function TrendChart({ data, comparisonLabel, granularity }: { data: TrendPoint[]; comparisonLabel: string; granularity: "day" | "month" }) {
  const hasTarget = data.some((d) => d.target != null);
  const hasCmp = data.some((d) => d.comparison != null && d.comparison !== 0);
  const last = [...data].reverse().find((d) => d.current != null);
  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2 mb-2" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded" style={{ background: C.current }} /> This period (cumulative)</li>
        {hasCmp && <li className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed" style={{ borderColor: C.comparison }} /> Comparison: {comparisonLabel}</li>}
        {hasTarget && <li className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dotted" style={{ borderColor: C.target }} /> Approved target (pro-rata)</li>}
      </ul>
      <div className="h-64" role="img" aria-label={`Cumulative revenue trend. Latest: ${formatInr(last?.current ?? null)}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="#e6eaed" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#b8c2c9" }} tick={{ fontSize: 11, fill: "#4a5a68" }} interval="preserveStartEnd" minTickGap={14} />
            <YAxis tickFormatter={(v) => formatInrCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#4a5a68" }} width={64} />
            <Tooltip
              cursor={{ stroke: "#b8c2c9", strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as TrendPoint;
                return (
                  <div className="rounded border border-line bg-panel px-3 py-2 text-xs shadow-sm">
                    <p className="font-medium mb-1">{granularity === "day" ? `Day ${label}` : label}</p>
                    <p>This period: <span className="num font-medium">{formatInr(p.current)}</span></p>
                    {p.comparison != null && <p className="text-ink-2">Comparison: <span className="num">{formatInr(p.comparison)}</span></p>}
                    {p.target != null && <p className="text-ink-2">Target: <span className="num">{formatInr(p.target)}</span></p>}
                  </div>
                );
              }}
            />
            {hasCmp && <Line type="monotone" dataKey="comparison" stroke={C.comparison} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
            {hasTarget && <Line type="monotone" dataKey="target" stroke={C.target} strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} />}
            <Line type="monotone" dataKey="current" stroke={C.current} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
