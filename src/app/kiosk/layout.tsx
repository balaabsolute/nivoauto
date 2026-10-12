import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth";
import { DATA_MODE } from "@/server/data-mode";
import { DeviceCorner } from "@/components/kiosk/DeviceCorner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };

export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  // Kiosk screens are for kiosk device accounts only; staff use the front desk.
  if (actor.role !== "kiosk") redirect("/front-desk?kiosk=staff");
  return (
    <div className="kiosk min-h-[100dvh] bg-[#0b2f38] text-white select-none overflow-hidden">
      {DATA_MODE === "demo" && <div className="hazard-tape h-1.5" aria-label="Demo environment" />}
      <DeviceCorner />
      {children}
    </div>
  );
}
