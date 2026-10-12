/** Display formatting (Indian numbering: lakh / crore). */

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function formatInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return inr.format(n);
}

/** Compact INR: ₹4.2 Cr, ₹38.5 L, ₹12.3 K. */
export function formatInrCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)} K`;
  return `${sign}₹${Math.round(a)}`;
}
function trim(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2);
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatDelta(n: number | null | undefined, unit: "%" | "pp" = "%"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n > 0 ? "+" : n < 0 ? "−" : "±";
  return `${s}${Math.abs(n).toFixed(1)}${unit === "pp" ? " pp" : "%"}`;
}

export function formatInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN").format(Math.round(n));
}

export function formatHours(h: number | null | undefined): string {
  if (h == null) return "—";
  if (h >= 48) return `${(h / 24).toFixed(1)} days`;
  return `${h.toFixed(1)} h`;
}

const dtf = new Intl.DateTimeFormat("en-IN", { timeZone: process.env.REPORTING_TZ ?? "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
const df = new Intl.DateTimeFormat("en-IN", { timeZone: process.env.REPORTING_TZ ?? "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dtf.format(typeof d === "string" ? new Date(d) : d);
}
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return df.format(typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00+05:30` : d) : d);
}

export function relativeTime(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "never";
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Date → value for an <input type="datetime-local">, in IST wall-clock time. */
export function toLocalInput(d: Date | null | undefined): string {
  if (!d) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
