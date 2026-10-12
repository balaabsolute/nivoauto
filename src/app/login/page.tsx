import { redirect } from "next/navigation";
import { getActor } from "@/server/auth";
import { homePathFor } from "@/domain/permissions";
import { DATA_MODE } from "@/server/data-mode";
import { DEMO_PASSWORD } from "@/db/demo-constants";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const DEMO = [
  { email: "md@demo.kun.local", label: "Managing Director" },
  { email: "finance@demo.kun.local", label: "Group finance" },
  { email: "manager.bmw@demo.kun.local", label: "Manager — Kun BMW" },
  { email: "advisor.bmw@demo.kun.local", label: "Service advisor — Kun BMW" },
  { email: "tech1.bmw@demo.kun.local", label: "Technician — Kun BMW" },
  { email: "sales1.hyu@demo.kun.local", label: "Sales consultant — Kun Hyundai" },
  { email: "kiosk.hyu@demo.kun.local", label: "Showroom / lounge kiosk — Kun Hyundai" },
  { email: "admin@demo.kun.local", label: "Administrator" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const actor = await getActor();
  if (actor) redirect(homePathFor(actor));
  const { next } = await searchParams;
  return (
    <main className="min-h-screen grid lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="hidden lg:flex flex-col justify-between bg-petrol-deep text-white p-12">
        <p className="text-sm font-semibold tracking-wide text-white/80">Kun Automobile</p>
        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-tight">One job record runs the workshop and informs the group.</h1>
          <p className="mt-4 text-white/75 leading-relaxed">
            Job cards, body shop stages, daily reports and customer updates feed the same group view, so the numbers come from the work itself.
          </p>
        </div>
        <p className="text-xs text-white/60">Group Intelligence &amp; Digital Operations Platform · Phase 1 pilot</p>
      </section>
      <section className="relative flex items-center justify-center p-6 sm:p-12 bg-panel">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold">Sign in</h2>
          <p className="text-sm text-ink-2 mt-1 mb-6">Use your Kun work account.</p>
          <LoginForm next={next} demoAccounts={DATA_MODE === "demo" ? DEMO : undefined} demoPassword={DATA_MODE === "demo" ? DEMO_PASSWORD : undefined} />
        </div>
        <p className="absolute bottom-4 right-6 text-xs text-ink-3">Concept and Developed by <a href="https://idataone.com" target="_blank" rel="noopener" className="font-medium text-petrol hover:underline">iDataOne</a></p>
      </section>
    </main>
  );
}
