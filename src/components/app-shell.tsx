"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Megaphone, UserPlus, Building2, Users, Target,
  FileText, FileSignature, Handshake, Coins, LifeBuoy, FolderKanban,
  Receipt, Package, CalendarCheck, Menu, X, LogOut, Clock, UsersRound, Banknote,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Phase 3+ modules are visible but marked so nobody expects a working screen. */
  soon?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Marketing",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/leads", label: "Leads", icon: UserPlus },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/accounts", label: "Accounts", icon: Building2 },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/opportunities", label: "Opportunities", icon: Target },
      { href: "/quotations", label: "Quotations", icon: FileText },
      { href: "/contracts", label: "Contracts", icon: FileSignature },
      { href: "/products", label: "Products", icon: Package },
    ],
  },
  {
    label: "Partners",
    items: [
      { href: "/partners", label: "Partners", icon: Handshake },
      { href: "/commissions", label: "Commissions", icon: Coins },
    ],
  },
  {
    label: "Delivery",
    items: [
      { href: "/cases", label: "Support Cases", icon: LifeBuoy },
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/timesheets", label: "Timesheets", icon: Clock },
      { href: "/resources", label: "Resources", icon: UsersRound },
      { href: "/activities", label: "Activities", icon: CalendarCheck },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/invoices", label: "Invoices", icon: Receipt },
      { href: "/payments", label: "Payments", icon: Banknote },
    ],
  },
];

export function AppShell({
  user,
  children,
}: {
  user: { fullName: string; email: string; roleName: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen">
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-card transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-5">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded bg-primary text-xs font-bold text-primary-foreground">
              BT
            </span>
            <span>BabulTech CRM</span>
          </Link>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                          isActive(item.href)
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1">{item.label}</span>
                        {item.soon && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            Phase 3
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t p-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
              {initials(user.fullName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{user.roleName}</p>
            </div>
            <form action="/api/auth/signout" method="post">
              <button type="submit" className="text-muted-foreground hover:text-foreground" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b bg-card px-4 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">BabulTech CRM</span>
        </header>
        <main className="flex-1 p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
