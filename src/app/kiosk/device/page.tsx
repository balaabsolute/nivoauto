import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth";
import { dealerships } from "@/db/schema";

export const metadata = { title: "Kiosk device" };

export default async function DevicePage() {
  const actor = await requireActor();
  const [d] = await (await getDb()).select().from(dealerships).where(eq(dealerships.id, actor.dealershipIds[0]));
  const btn = "block rounded-2xl bg-white text-[#0b2f38] px-8 py-6 text-[clamp(18px,1.8vw,32px)] font-semibold text-center";
  return (
    <div className="min-h-[100dvh] px-[6vw] py-[6vh]">
      <p className="text-white/70 text-[clamp(14px,1.2vw,22px)]">Staff only</p>
      <h1 className="text-[clamp(28px,3vw,56px)] font-semibold mt-1">Kiosk device</h1>
      <p className="mt-2 text-white/80 text-[clamp(16px,1.4vw,26px)]">{actor.name} · {d?.name}</p>
      <div className="mt-[5vh] grid gap-4 max-w-[640px]">
        <Link href="/kiosk" className={btn}>Showroom screen (walk-ins)</Link>
        <Link href="/kiosk/lounge" className={btn}>Lounge screen (feedback)</Link>
        <form action="/logout" method="post"><button className="w-full rounded-2xl border-2 border-white/40 px-8 py-6 text-[clamp(18px,1.8vw,32px)]">Sign this device out</button></form>
      </div>
      <p className="mt-[5vh] text-white/60 max-w-[60ch] text-[clamp(13px,1.05vw,20px)]">
        Tip: open this site in the browser&apos;s full-screen / kiosk mode (Android “Screen pinning”, Chrome kiosk mode, or “Add to Home screen”). To reach this menu again, tap the top-right corner five times.
      </p>
    </div>
  );
}
