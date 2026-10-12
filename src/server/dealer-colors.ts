import { cache } from "react";
import { getDb } from "@/db/client";
import { dealerships } from "@/db/schema";
import { dealerColor } from "@/domain/dealer-colors";

/** Per-request lookup of every dealership's identity colour, by id and by name. */
export const dealerColors = cache(async () => {
  const rows = await (await getDb()).select({ id: dealerships.id, name: dealerships.name, code: dealerships.code, color: dealerships.color }).from(dealerships);
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const r of rows) {
    const c = dealerColor(r);
    byId.set(r.id, c);
    byName.set(r.name, c);
  }
  return { byId, byName, of: (idOrName: string | null | undefined) => (idOrName ? byId.get(idOrName) ?? byName.get(idOrName) ?? "#8a959e" : "#8a959e") };
});
