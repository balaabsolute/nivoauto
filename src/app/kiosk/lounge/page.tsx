import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth";
import { groupCatalogue } from "@/server/services/crm";
import { dealerships } from "@/db/schema";
import { LoungeKiosk } from "@/components/kiosk/LoungeKiosk";

export const metadata = { title: "Lounge" };

export default async function LoungePage() {
  const actor = await requireActor();
  const db = await getDb();
  const [d] = await db.select().from(dealerships).where(eq(dealerships.id, actor.dealershipIds[0]));
  const cat = await groupCatalogue(db);
  return (
    <LoungeKiosk
      dealershipName={d?.name ?? "Kun Automobile"}
      models={cat.map((c) => ({ id: c.m.id, name: c.m.name, brand: c.brand, bodyType: c.m.bodyType }))}
      brands={[...new Set(cat.map((c) => c.brand))]}
    />
  );
}
