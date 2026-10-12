import { ForbiddenError } from "@/domain/permissions";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { PeriodError } from "@/domain/periods";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; issues?: string[] };

/** Map domain errors to user-facing messages; unexpected errors are logged and hidden. */
export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  const started = Date.now();
  try {
    const data = await fn();
    const ms = Date.now() - started;
    if (ms > 1000) console.warn(`[action] slow server action: ${ms} ms`);
    return { ok: true, data, message };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.issues.join(" "), issues: e.issues };
    if (e instanceof ForbiddenError || e instanceof ConflictError || e instanceof NotFoundError || e instanceof PeriodError) return { ok: false, error: e.message };
    if (e && typeof e === "object" && "digest" in e) throw e; // let Next redirects/notFound through
    console.error("[action] unexpected error", e);
    return { ok: false, error: "Something went wrong and the change was not saved. Try again; if it persists, contact your administrator." };
  }
}
