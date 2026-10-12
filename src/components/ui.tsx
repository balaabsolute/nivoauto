import Link from "next/link";
import clsx from "clsx";
import { Icon } from "./Icon";
import { formatDelta, relativeTime, formatDate } from "@/domain/format";

export function PageHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-5">
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-petrol hover:underline mb-2 no-print">
          <Icon name="back" className="h-3.5 w-3.5" /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="h1">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-ink-2">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
    </header>
  );
}

export function Panel({ title, subtitle, actions, children, className, bodyClassName, id }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section className={clsx("panel", className)} id={id} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5 pb-2">
          <div className="min-w-0">
            {title && <h2 id={id ? `${id}-title` : undefined} className="h2">{title}</h2>}
            {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={clsx("px-4 pb-4", !title && !actions && "pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "good" | "warn" | "crit" | "info" | "neutral" | "petrol";
const TONES: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
  info: "bg-info-soft text-info",
  neutral: "bg-page text-ink-2 border border-line",
  petrol: "bg-petrol-soft text-petrol-deep",
};
export function Chip({ tone = "neutral", children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return <span title={title} className={clsx("chip", TONES[tone], className)}>{children}</span>;
}

export function SeverityChip({ severity }: { severity: "critical" | "warning" | "info" }) {
  const map = { critical: { tone: "crit" as const, label: "Critical", icon: "alert" }, warning: { tone: "warn" as const, label: "Warning", icon: "alert" }, info: { tone: "info" as const, label: "Info", icon: "info" } };
  const m = map[severity];
  return (
    <Chip tone={m.tone}>
      <Icon name={m.icon} className="h-3 w-3" /> {m.label}
    </Chip>
  );
}

export function SignalChip({ signal }: { signal: "critical" | "warning" | "info" | "ok" | "no_data" }) {
  if (signal === "no_data") return <Chip tone="neutral">No data</Chip>;
  if (signal === "ok" || signal === "info") return <Chip tone="good"><Icon name="check" className="h-3 w-3" /> On track</Chip>;
  return <SeverityChip severity={signal} />;
}

/** Signed change with direction word for screen readers; colour only reinforces. */
export function Delta({ value, unit = "%", goodWhenUp = true, label }: { value: number | null; unit?: "%" | "pp"; goodWhenUp?: boolean; label?: string }) {
  if (value == null) return <span className="text-xs text-ink-3">{label ? `${label}: ` : ""}no comparison</span>;
  const up = value > 0;
  const tone = value === 0 ? "text-ink-2" : up === goodWhenUp ? "text-good" : "text-crit";
  return (
    <span className={clsx("text-xs font-medium num", tone)}>
      <span aria-hidden>{value > 0 ? "▲" : value < 0 ? "▼" : "■"}</span> {formatDelta(value, unit)}
      {label && <span className="text-ink-3 font-normal"> {label}</span>}
    </span>
  );
}

export function EmptyState({ title, children, action, icon = "info" }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-page text-ink-3 mb-3"><Icon name={icon} className="h-5 w-5" /></span>
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-ink-2 mt-1 max-w-md">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "crit" | "good"; children: React.ReactNode; title?: string }) {
  const cls = { info: "border-info/30 bg-info-soft", warn: "border-warn/30 bg-warn-soft", crit: "border-crit/30 bg-crit-soft", good: "border-good/30 bg-good-soft" }[tone];
  return (
    <div role={tone === "crit" ? "alert" : "status"} className={clsx("rounded border px-3 py-2 text-sm", cls)}>
      {title && <p className="font-medium">{title}</p>}
      <div className={clsx(title && "mt-0.5", "text-ink-2")}>{children}</div>
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="relative">
      <div className="hazard-tape h-1.5 print:hidden" aria-hidden />
      <div className="bg-ink text-white text-[13px] px-4 py-1.5 flex flex-wrap items-center gap-x-2">
        <strong className="font-semibold text-hazard">Demo data</strong>
        <span className="text-white/85">Every figure shown is synthetic and illustrative — not Kun Automobile data.</span>
      </div>
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-sm mt-0.5 break-words">{children}</dd>
    </div>
  );
}

export function Freshness({ at, label }: { at: Date | null; label: string }) {
  return (
    <span className="text-xs text-ink-2" title={at ? at.toISOString() : undefined}>
      {label} <span className="font-medium text-ink">{relativeTime(at)}</span>
    </span>
  );
}

export function ProgressBar({ value, max = 100, tone = "petrol", label }: { value: number | null; max?: number; tone?: "petrol" | "good" | "warn" | "crit"; label: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const bar = { petrol: "bg-petrol", good: "bg-good", warn: "bg-warn", crit: "bg-crit" }[tone];
  return (
    <div className="h-1.5 w-full rounded-full bg-line" role="meter" aria-label={label} aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={max}>
      <div className={clsx("h-full rounded-full", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DateText({ d }: { d: Date | string | null }) {
  return <>{formatDate(d)}</>;
}
