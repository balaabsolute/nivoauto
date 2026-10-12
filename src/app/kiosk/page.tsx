import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth";
import { catalogueForDealership } from "@/server/services/crm";
import { dealerships } from "@/db/schema";
import { ShowroomKiosk } from "@/components/kiosk/ShowroomKiosk";

export default async function KioskPage() {
  const actor = await requireActor();
  const db = await getDb();
  const dealershipId = actor.dealershipIds[0];
  if (!dealershipId) return <p className="p-10 text-2xl">This kiosk isn’t linked to a dealership. Ask an administrator.</p>;
  const [d] = await db.select().from(dealerships).where(eq(dealerships.id, dealershipId));
  const models = await catalogueForDealership(db, dealershipId);
  return (
    <ShowroomKiosk
      dealershipName={d.name}
      facilities={{ sales: d.hasSales, service: d.hasService, bodyShop: d.hasBodyShop }}
      models={models.map((m) => ({ id: m.id, name: m.name, bodyType: m.bodyType, priceBand: m.priceBand, fuelTypes: m.fuelTypes }))}
    />
  );
}
