"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";

const OPTIONS = [
  { key: "today", label: "Today" },
  { key: "mtd", label: "Month to date" },
  { key: "prev_month", label: "Previous month" },
  { key: "qtd", label: "Quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom" },
];

export function PeriodSelector({ current, start, end, today }: { current: string; start: string; end: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [showCustom, setShowCustom] = useState(current === "custom");
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);

  const go = (params: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) (v == null ? next.delete(k) : next.set(k, v));
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className="flex flex-col items-start sm:items-end gap-2" aria-busy={pending}>
      <div role="group" aria-label="Reporting period" className="inline-flex flex-wrap rounded border border-line-strong bg-panel p-0.5">
        {OPTIONS.map((o) => {
          const active = o.key === "custom" ? showCustom || current === "custom" : current === o.key && !showCustom;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={active}
              onClick={() => (o.key === "custom" ? setShowCustom(true) : (setShowCustom(false), go({ period: o.key, from: null, to: null })))}
              className={clsx("px-2.5 sm:px-3 h-8 text-[13px] rounded-sm whitespace-nowrap", active ? "bg-petrol text-white font-medium" : "text-ink-2 hover:text-ink")}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {showCustom && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ period: "custom", from, to });
          }}
        >
          <label className="text-xs text-ink-2">From<input type="date" className="field h-8 mt-0.5" value={from} max={today} onChange={(e) => setFrom(e.target.value)} required /></label>
          <label className="text-xs text-ink-2">To<input type="date" className="field h-8 mt-0.5" value={to} max={today} onChange={(e) => setTo(e.target.value)} required /></label>
          <button className="btn-primary btn-sm">Apply</button>
        </form>
      )}
      {pending && <span className="text-xs text-ink-2" role="status">Updating figures…</span>}
      {pending && <style>{`main#main > *:not(header) { opacity: .55; transition: opacity .15s; pointer-events: none; }`}</style>}
    </div>
  );
}
