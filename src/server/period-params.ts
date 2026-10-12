import { resolvePeriod, businessDate, PERIOD_KEYS, PeriodError, type Period, type PeriodKey } from "@/domain/periods";

export type SP = Record<string, string | string[] | undefined>;
export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Parse ?period=&from=&to= into a Period. Invalid input falls back to MTD with a message. */
export function periodFromParams(sp: SP, fallback: PeriodKey = "mtd"): { period: Period; error?: string } {
  const today = businessDate();
  const key = (first(sp.period) ?? fallback) as PeriodKey;
  try {
    if (!PERIOD_KEYS.includes(key)) throw new PeriodError(`Unknown period "${key}"`);
    return { period: resolvePeriod(key, today, { start: first(sp.from), end: first(sp.to) }) };
  } catch (e) {
    return { period: resolvePeriod(fallback, today), error: e instanceof Error ? e.message : "Invalid period" };
  }
}

export function periodQuery(p: Period): string {
  return p.key === "custom" ? `period=custom&from=${p.start}&to=${p.end}` : `period=${p.key}`;
}
