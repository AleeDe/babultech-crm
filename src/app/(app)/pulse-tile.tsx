"use client";

import Link from "next/link";
import {
  Target, TrendingUp, Banknote, Receipt, LifeBuoy, Handshake,
  FolderKanban, CalendarCheck,
} from "lucide-react";
import { Sparkline, Delta, CountUp } from "@/components/sparkline";
import { cn, formatCompactMoney } from "@/lib/utils";

/**
 * Icons and formatters are chosen here rather than passed in.
 *
 * Both are functions, and a function cannot cross the server→client boundary —
 * it has no serialisable form. The server sends a name, the client resolves it.
 * Doing this with a lookup rather than a prop also means an unknown key fails
 * at the type level instead of rendering a blank tile at runtime.
 */
const ICONS = {
  Target, TrendingUp, Banknote, Receipt, LifeBuoy, Handshake,
  FolderKanban, CalendarCheck,
} as const;
export type PulseIcon = keyof typeof ICONS;

const FORMATS = {
  money: (n: number) => formatCompactMoney(n),
  count: (n: number) => String(Math.round(n)),
} as const;
export type PulseFormat = keyof typeof FORMATS;

/**
 * The headline figure, its 30-day shape, and its week-on-week direction.
 *
 * Three facts in one tile, which is the most a glance can carry (the fourth
 * would be read as decoration and ignored). The value answers "how much", the
 * sparkline "which way", the delta "by how much" — each redundant enough that
 * losing one to a small screen still leaves the tile meaningful.
 *
 * `raw` is passed alongside the formatted string so the count-up can animate a
 * real number rather than parse it back out of "PKR 4.2M".
 */
export function PulseTile({
  label,
  raw,
  format = "money",
  sublabel,
  series,
  delta,
  goodDirection = "up",
  href,
  icon,
  tone = "primary",
}: {
  label: string;
  raw: number;
  format?: PulseFormat;
  sublabel?: string;
  /**
   * Omit where no honest 30-day series exists for the figure. A flat line of
   * zeros is not "no trend" — it draws as a real trend that happens to be
   * nothing, which is a claim about the data rather than an absence of it.
   */
  series?: number[];
  delta: number | null;
  goodDirection?: "up" | "down";
  href: string;
  icon: PulseIcon;
  tone?: "primary" | "success" | "danger" | "muted";
}) {
  const Icon = ICONS[icon];
  const formatValue = FORMATS[format];
  const glow = {
    primary: "hover:border-cyan-500/40 hover:shadow-[0_0_24px_-8px_rgba(6,182,212,0.45)]",
    success: "hover:border-emerald-500/40 hover:shadow-[0_0_24px_-8px_rgba(16,185,129,0.45)]",
    danger: "hover:border-red-500/40 hover:shadow-[0_0_24px_-8px_rgba(239,68,68,0.45)]",
    muted: "hover:border-border",
  }[tone];

  const iconTint = {
    primary: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    danger: "bg-red-500/10 text-red-600 dark:text-red-400",
    muted: "bg-muted text-muted-foreground",
  }[tone];

  return (
    <Link
      href={href}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border bg-card p-4 transition-all duration-200",
        glow,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", iconTint)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
        </span>
      </div>

      <p className="mt-2.5 text-2xl font-semibold tracking-tight">
        <CountUp value={raw} format={formatValue} />
      </p>

      <div className="mt-1 flex items-center justify-between gap-2">
        {sublabel && (
          <span className="truncate text-xs text-muted-foreground">{sublabel}</span>
        )}
        <Delta value={delta} good={goodDirection} className="shrink-0" />
      </div>

      {series && series.length > 0 && (
        <div className="-mx-4 -mb-4 mt-3 opacity-70 transition-opacity group-hover:opacity-100">
          <Sparkline values={series} tone={tone} height={36} />
        </div>
      )}
    </Link>
  );
}
