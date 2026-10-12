/**
 * Date-period semantics (documented in docs/KPI_DEFINITIONS.md §1).
 *
 *  - All business dates are calendar dates in the group's reporting time zone
 *    (REPORTING_TZ, default Asia/Kolkata), represented as "YYYY-MM-DD" strings.
 *  - Periods are INCLUSIVE of both start and end dates.
 *  - "Quarter" and "Year-to-date" follow the financial year, which starts in
 *    FY_START_MONTH (default 4 = April, the Indian FY). Calendar years: set to 1.
 *  - Every period has a comparison period of the same shape immediately before it:
 *      today       → yesterday
 *      mtd         → same day-span of the previous month (capped at that month's length)
 *      prev_month  → the month before it
 *      qtd         → same day-span of the previous quarter
 *      ytd         → same day-span of the previous financial year
 *      custom      → the same number of days immediately preceding
 */

export type PeriodKey = "today" | "mtd" | "prev_month" | "qtd" | "ytd" | "custom";
export const PERIOD_KEYS: PeriodKey[] = ["today", "mtd", "prev_month", "qtd", "ytd", "custom"];

export interface DateRange {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
}

export interface Period extends DateRange {
  key: PeriodKey;
  label: string;
  days: number;
  comparison: DateRange & { label: string };
  granularity: "day" | "month";
}

export const REPORTING_TZ = process.env.REPORTING_TZ ?? "Asia/Kolkata";
export const FY_START_MONTH = Number(process.env.FY_START_MONTH ?? 4);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string | undefined | null): s is string {
  if (!s || !DATE_RE.test(s)) return false;
  const d = parse(s);
  return toIso(d) === s;
}

function parse(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Calendar date in the reporting time zone for an instant. */
export function businessDate(at: Date = new Date(), tz: string = REPORTING_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(s: string, n: number): string {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

/** Inclusive day count. */
export function daysInclusive(start: string, end: string): number {
  return Math.round((parse(end).getTime() - parse(start).getTime()) / 86_400_000) + 1;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function monthKey(s: string): string {
  return s.slice(0, 7);
}

function ymd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
function fmt(y: number, m: number, d: number): string {
  // normalise month overflow
  const date = new Date(Date.UTC(y, m - 1, 1));
  const yy = date.getUTCFullYear();
  const mm = date.getUTCMonth() + 1;
  const dd = Math.min(d, daysInMonth(yy, mm));
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
function monthStart(s: string): string {
  const { y, m } = ymd(s);
  return fmt(y, m, 1);
}
function monthEnd(s: string): string {
  const { y, m } = ymd(s);
  return fmt(y, m, daysInMonth(y, m));
}
function shiftMonths(s: string, n: number, day?: number): string {
  const { y, m, d } = ymd(s);
  return fmt(y, m + n, day ?? d);
}

/** Start of the financial quarter containing `s`. */
export function quarterStart(s: string, fyStartMonth = FY_START_MONTH): string {
  const { y, m } = ymd(s);
  const offset = (m - fyStartMonth + 12) % 12; // months since FY start
  const qOffset = offset - (offset % 3);
  return fmt(y, m - (offset - qOffset), 1);
}
/** Start of the financial year containing `s`. */
export function fyStart(s: string, fyStartMonth = FY_START_MONTH): string {
  const { y, m } = ymd(s);
  const startYear = m >= fyStartMonth ? y : y - 1;
  return fmt(startYear, fyStartMonth, 1);
}
export function fyLabel(s: string, fyStartMonth = FY_START_MONTH): string {
  const start = fyStart(s, fyStartMonth);
  const y = Number(start.slice(0, 4));
  if (fyStartMonth === 1) return `CY${y}`;
  return `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}
export function quarterLabel(s: string, fyStartMonth = FY_START_MONTH): string {
  const qs = quarterStart(s, fyStartMonth);
  const offset = (ymd(qs).m - fyStartMonth + 12) % 12;
  return `Q${offset / 3 + 1} ${fyLabel(s, fyStartMonth)}`;
}

/** Same-span window: from `start` covering `span` days, capped at `cap` (inclusive). */
function spanFrom(start: string, span: number, cap: string): string {
  const end = addDays(start, span - 1);
  return end > cap ? cap : end;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDateShort(s: string): string {
  const { y, m, d } = ymd(s);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function rangeLabel(r: DateRange): string {
  return r.start === r.end ? formatDateShort(r.start) : `${formatDateShort(r.start)} – ${formatDateShort(r.end)}`;
}

export class PeriodError extends Error {}

export function resolvePeriod(
  key: PeriodKey,
  today: string,
  custom?: Partial<DateRange>,
  fyStartMonth = FY_START_MONTH,
): Period {
  if (!isIsoDate(today)) throw new PeriodError(`Invalid business date: ${today}`);
  let start: string;
  let end: string;
  let comp: DateRange;
  let label: string;

  switch (key) {
    case "today": {
      start = end = today;
      comp = { start: addDays(today, -1), end: addDays(today, -1) };
      label = "Today";
      break;
    }
    case "mtd": {
      start = monthStart(today);
      end = today;
      const span = daysInclusive(start, end);
      const cs = shiftMonths(start, -1, 1);
      comp = { start: cs, end: spanFrom(cs, span, monthEnd(cs)) };
      label = "Month to date";
      break;
    }
    case "prev_month": {
      start = shiftMonths(monthStart(today), -1, 1);
      end = monthEnd(start);
      const cs = shiftMonths(start, -1, 1);
      comp = { start: cs, end: monthEnd(cs) };
      label = "Previous month";
      break;
    }
    case "qtd": {
      start = quarterStart(today, fyStartMonth);
      end = today;
      const span = daysInclusive(start, end);
      const cs = shiftMonths(start, -3, 1);
      comp = { start: cs, end: spanFrom(cs, span, addDays(start, -1)) };
      label = `Quarter to date (${quarterLabel(today, fyStartMonth)})`;
      break;
    }
    case "ytd": {
      start = fyStart(today, fyStartMonth);
      end = today;
      const span = daysInclusive(start, end);
      const cs = shiftMonths(start, -12, 1);
      comp = { start: cs, end: spanFrom(cs, span, addDays(start, -1)) };
      label = `Year to date (${fyLabel(today, fyStartMonth)})`;
      break;
    }
    case "custom": {
      if (!isIsoDate(custom?.start) || !isIsoDate(custom?.end)) throw new PeriodError("Custom range needs valid start and end dates");
      start = custom!.start!;
      end = custom!.end!;
      if (start > end) throw new PeriodError("Custom range start must be on or before end");
      if (end > today) throw new PeriodError("Custom range cannot end in the future");
      const span = daysInclusive(start, end);
      if (span > 731) throw new PeriodError("Custom range is limited to 2 years");
      comp = { start: addDays(start, -span), end: addDays(start, -1) };
      label = "Custom range";
      break;
    }
    default:
      throw new PeriodError(`Unknown period: ${key satisfies never}`);
  }

  const days = daysInclusive(start, end);
  return {
    key,
    label,
    start,
    end,
    days,
    comparison: { ...comp, label: rangeLabel(comp) },
    granularity: days > 62 ? "month" : "day",
  };
}

export function periodRangeLabel(p: DateRange): string {
  return rangeLabel(p);
}

export function eachDay(r: DateRange): string[] {
  const out: string[] = [];
  for (let d = r.start; d <= r.end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function eachMonth(r: DateRange): string[] {
  const out: string[] = [];
  for (let m = monthStart(r.start); m <= r.end; m = shiftMonths(m, 1, 1)) out.push(monthKey(m));
  return out;
}

export function inRange(d: string, r: DateRange): boolean {
  return d >= r.start && d <= r.end;
}

/** Number of days of `r` that fall in calendar month `month` (YYYY-MM). */
export function daysOfRangeInMonth(r: DateRange, month: string): number {
  const ms = `${month}-01`;
  const me = monthEnd(ms);
  const s = r.start > ms ? r.start : ms;
  const e = r.end < me ? r.end : me;
  return s > e ? 0 : daysInclusive(s, e);
}

/** Count working days in a range given a Mon..Sun mask like "1111110". */
export function workingDays(r: DateRange, mask = "1111110"): number {
  let n = 0;
  for (const d of eachDay(r)) {
    const dow = (parse(d).getUTCDay() + 6) % 7; // Mon=0
    if (mask[dow] === "1") n++;
  }
  return n;
}

/** UTC instant bounds for a business-date range in the reporting time zone. */
export function rangeToInstants(r: DateRange, tz: string = REPORTING_TZ): { from: Date; to: Date } {
  return { from: zonedMidnight(r.start, tz), to: zonedMidnight(addDays(r.end, 1), tz) };
}

/** UTC instant of local midnight for a date in a time zone. */
export function zonedMidnight(date: string, tz: string = REPORTING_TZ): Date {
  const guess = parse(date); // midnight UTC
  const offsetMin = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}
