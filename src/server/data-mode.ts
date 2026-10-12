import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * DATA_MODE separates demo from production data.
 *  - "demo" (default): demo records are shown, and every screen carries a DEMO DATA banner.
 *  - "live": records flagged is_demo are excluded from every query, and demo seeding is refused.
 */
export type DataMode = "demo" | "live";
export const DATA_MODE: DataMode = process.env.DATA_MODE === "live" ? "live" : "demo";

export function demoFilter(col: PgColumn): SQL | undefined {
  return DATA_MODE === "live" ? eq(col, false) : undefined;
}
