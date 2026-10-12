import clsx from "clsx";
import { Delta } from "@/components/ui";
import { formatPct, formatInt } from "@/domain/format";

export function Tile({ label, value, delta, note, tone, href }: { label: string; value: React.ReactNode; delta?: number | null; note?: React.ReactNode; tone?: "good" | "warn" | "crit"; href?: string }) {
  const inner = (
    <>
      <dt className="text-[12.5px] text-ink-2 leading-tight">{label}</dt>
      <dd className={clsx("mt-1.5 text-[26px] leading-none font-semibold tracking-tight num", tone === "good" && "text-good", tone === "warn" && "text-warn", tone === "crit" && "text-crit")}>{value}</dd>
      {delta !== undefined && <dd className="mt-1.5"><Delta value={delta} label="vs comparison" /></dd>}
      {note && <dd className="mt-1 text-xs text-ink-3">{note}</dd>}
    </>
  );
  return <div className="panel p-3.5 min-w-0">{href ? <a href={href} className="block hover:opacity-80">{inner}</a> : inner}</div>;
}

export function TileGroup({ title, subtitle, children, cols = 6 }: { title: string; subtitle?: string; children: React.ReactNode; cols?: 4 | 5 | 6 }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-ink-3">{subtitle}</p>}
      </div>
      <dl className={clsx("grid gap-3 grid-cols-2 md:grid-cols-3", cols === 6 ? "xl:grid-cols-6" : cols === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4")}>{children}</dl>
    </section>
  );
}

/** Labelled horizontal bars for a small tally (one hue, values printed). */
export function TallyBars({ rows, label = (k: string) => k, empty = "Nothing recorded in this period" }: { rows: { key: string; n: number }[]; label?: (k: string) => string; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-ink-3">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.n), 1);
  const total = rows.reduce((a, r) => a + r.n, 0);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{label(r.key)}</span>
            <span className="num font-medium">{formatInt(r.n)} <span className="text-ink-3 font-normal text-xs">{formatPct((r.n / total) * 100, 0)}</span></span>
          </div>
          <div className="mt-1 h-2 rounded-r bg-line/60"><div className="h-full rounded-r bg-[#2a78d6]" style={{ width: `${(r.n / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

/** Outcome split as one stacked bar with a legend. */
export function OutcomeBar({ parts }: { parts: { label: string; n: number; className: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return <p className="text-sm text-ink-3">No enquiries closed in this period</p>;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
        {parts.map((p) => p.n > 0 && <div key={p.label} className={p.className} style={{ width: `${(p.n / total) * 100}%` }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5"><span className={clsx("h-2.5 w-2.5 rounded-sm", p.className)} aria-hidden />{p.label}</span>
            <span className="num font-medium">{formatInt(p.n)} <span className="text-xs text-ink-3 font-normal">{formatPct((p.n / total) * 100, 0)}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
