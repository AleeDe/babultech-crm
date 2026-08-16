"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CheckSquare, Target, Users, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation for phones.
 *
 * Reaching any screen previously cost: tap the menu, wait for the drawer,
 * scan eight groups, scroll, tap. Under KLM that is roughly
 * point + tap + mental prep + scroll + point + tap — four to five seconds for
 * something done dozens of times a day.
 *
 * Four destinations at the bottom make the common ones a single tap, and the
 * bottom edge is where the thumb already rests on a phone held one-handed —
 * Fitts's Law rewards the near edge, not the far one.
 *
 * Which four: the screens a person opens without deciding to. Everything else
 * stays behind the menu, where deliberate navigation belongs.
 */
const ITEMS = [
  { href: "/", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/my-work", label: "My work", icon: CheckSquare },
  { href: "/opportunities", label: "Deals", icon: Target },
  { href: "/accounts", label: "Accounts", icon: Users },
];

export function MobileNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur lg:hidden"
      // Keeps the bar clear of the home indicator on iPhones.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href, item.exact);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] transition-colors",
                  active ? "font-medium text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}

        <li className="flex-1">
          <button
            onClick={onOpenMenu}
            aria-label="Open the full menu"
            className="flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] text-muted-foreground transition-colors"
          >
            <Menu className="h-5 w-5" />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
