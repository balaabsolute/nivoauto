import Link from "next/link";
import clsx from "clsx";
export function LeadTabs({ current, canPublish }: { current: "performance" | "list" | "followups" | "updates"; canPublish: boolean }) {
  const tabs = [
    { k: "performance", href: "/leads/performance", l: "Performance" },
    { k: "list", href: "/leads", l: "Enquiries" },
    { k: "followups", href: "/leads?view=followups", l: "Follow-ups due" },
    ...(canPublish ? [{ k: "updates", href: "/leads/updates", l: "Model updates (nurture)" }] : [{ k: "updates", href: "/leads/updates", l: "Model updates" }]),
  ];
  return (
    <nav aria-label="Enquiries" className="flex gap-1 overflow-x-auto border-b border-line mb-5 -mx-4 px-4">
      {tabs.map((t) => (
        <Link key={t.k} href={t.href} aria-current={current === t.k ? "page" : undefined} className={clsx("whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px", current === t.k ? "border-petrol text-petrol font-medium" : "border-transparent text-ink-2 hover:text-ink")}>
          {t.l}
        </Link>
      ))}
    </nav>
  );
}
