import type { DB } from "@/db/client";
import { auditLog } from "@/db/schema";

type Tx = Pick<DB, "insert">;

/** Append-only audit record for sensitive changes (who, what, when, before/after). */
export async function audit(
  db: Tx,
  e: { userId: string | null; action: string; entityType: string; entityId?: string | null; dealershipId?: string | null; before?: unknown; after?: unknown },
): Promise<void> {
  await db.insert(auditLog).values({
    userId: e.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    dealershipId: e.dealershipId ?? null,
    before: (e.before ?? null) as never,
    after: (e.after ?? null) as never,
  });
}

/** Only the fields that actually changed. */
export function diff<T extends Record<string, unknown>>(before: T, patch: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) {
    const pv = patch[k];
    const bv = before[k];
    const same = pv instanceof Date && bv instanceof Date ? pv.getTime() === bv.getTime() : pv === bv;
    if (!same && pv !== undefined) {
      b[k] = bv;
      a[k] = pv as T[keyof T];
    }
  }
  return { before: b, after: a };
}
