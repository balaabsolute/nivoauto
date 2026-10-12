import Link from "next/link";
import clsx from "clsx";
const TABS = [
  { href: "/admin", label: "Users & access" },
  { href: "/admin/dealerships", label: "Entities & dealerships" },
  { href: "/admin/models", label: "Car models" },
  { href: "/admin/workflow", label: "Workflow stages" },
  { href: "/admin/capacity", label: "Capacity" },
  { href: "/admin/audit", label: "Audit trail" },
];
export function AdminTabs({ current }: { current: string }) {
  return (
    <nav aria-label="Administration" className="flex gap-1 overflow-x-auto border-b border-line mb-5 -mx-4 px-4">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={current === t.href ? "page" : undefined} className={clsx("whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px", current === t.href ? "border-petrol text-petrol font-medium" : "border-transparent text-ink-2 hover:text-ink")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
