"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Icon } from "./Icon";
import { NAV_GROUPS, type NavItem } from "./nav";

function isActive(pathname: string, item: NavItem, all: NavItem[]) {
  const prefix = item.match ?? item.href;
  if (!(pathname === prefix || pathname.startsWith(prefix + "/"))) return false;
  // prefer the most specific match (e.g. /admin/audit over /admin)
  return !all.some((o) => o !== item && (o.match ?? o.href).startsWith(prefix + "/") && pathname.startsWith(o.match ?? o.href));
}

export function Shell({ nav, user, children, banner }: { nav: NavItem[]; user: { name: string; roleLabel: string }; children: React.ReactNode; banner?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const groups = NAV_GROUPS.map((g) => ({ g, items: nav.filter((n) => n.group === g) })).filter((x) => x.items.length);
  const links = (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
      {groups.map(({ g, items }) => (
        <div key={g}>
          {groups.length > 1 && <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/45">{g}</p>}
          <ul className="space-y-0.5">
            {items.map((n) => {
              const active = isActive(pathname, n, nav);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "flex items-center gap-3 rounded px-3 py-1.5 text-sm",
                      active ? "bg-white/10 text-white font-medium" : "text-white/70 hover:text-white hover:bg-white/5",
                    )}
                  >
                    <Icon name={n.icon} className="h-[18px] w-[18px] shrink-0" />
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 p-3">
      <p className="text-sm text-white font-medium truncate">{user.name}</p>
      <p className="text-xs text-white/60 truncate">{user.roleLabel}</p>
      <form action="/logout" method="post" className="mt-2">
        <button className="inline-flex items-center gap-2 text-xs text-white/70 hover:text-white">
          <Icon name="logout" className="h-3.5 w-3.5" /> Sign out
        </button>
      </form>
    </div>
  );

  const brand = (
    <div className="px-4 h-14 flex items-center gap-2.5 border-b border-white/10">
      <span className="grid h-7 w-7 place-items-center rounded bg-white text-petrol-deep text-[13px] font-bold">K</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-white">Kun Automobile</span>
        <span className="block text-2xs text-white/60">Group operations</span>
      </span>
    </div>
  );

  return (
    <div className="min-h-screen">
      {banner}
      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 bg-petrol-deep lg:sticky lg:top-0 lg:h-screen no-print">
          {brand}
          {links}
          {footer}
        </aside>
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-30 bg-petrol-deep no-print">
          <div className="flex items-center justify-between h-12 px-3">
            <button aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="p-2 -ml-2 text-white">
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-white">Kun Automobile</span>
            <span className="w-9" />
          </div>
        </div>
        {open && (
          <div className="lg:hidden fixed inset-0 z-40 no-print" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
            <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-petrol-deep flex flex-col">
              <div className="flex items-center justify-between pr-2">
                {brand}
                <button aria-label="Close menu" onClick={() => setOpen(false)} className="p-2 text-white">
                  <Icon name="close" className="h-5 w-5" />
                </button>
              </div>
              {links}
              {footer}
            </aside>
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col min-h-screen lg:min-h-[calc(100vh-var(--banner-h,0px))]">
          <main id="main" className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-5 sm:py-6 max-w-[1440px] w-full">{children}</main>
          <footer className="px-4 sm:px-6 lg:px-8 py-4 max-w-[1440px] w-full flex justify-end text-xs text-ink-3 no-print">
            <p>Concept and Developed by <a href="https://idataone.com" target="_blank" rel="noopener" className="font-medium text-petrol hover:underline">iDataOne</a></p>
          </footer>
        </div>
      </div>
    </div>
  );
}
