import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth";
import { Shell } from "@/components/Shell";
import { navFor } from "@/components/nav";
import { ROLE_LABELS } from "@/domain/permissions";
import { DATA_MODE } from "@/server/data-mode";
import { DemoBanner } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (actor.role === "kiosk") redirect("/kiosk"); // device accounts only see the kiosk screens
  return (
    <Shell nav={navFor(actor)} user={{ name: actor.name, roleLabel: ROLE_LABELS[actor.role] }} banner={DATA_MODE === "demo" ? <DemoBanner /> : undefined}>
      {children}
    </Shell>
  );
}
