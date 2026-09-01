"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { cn } from "@/lib/utils";

/**
 * The pieces every dashboard view is built from.
 *
 * The old dashboard hand-rolled each panel, which is why twenty-seven of them
 * drifted into twenty-seven slightly different shapes. Sharing the parts means a
 * figure looks and behaves the same whichever view it appears in — the reader
 * learns the vocabulary once.
 */

/**
 * A headline figure, its direction, and its shape over the window.
 *
 * Three facts, which is about the most a glance carries. The value answers "how
 * much", the delta "which way", the sparkline "how did it get here". A number
 * alone is nearly useless — 40 open deals is good or bad only against last week.
 *
 * `goodDirection` exists because up is not always good: rising overdue
 * receivables is bad, and colouring it green because the arrow points up would
 * be actively misleading.
 */
export function Kpi({
  label,
  value,
  sublabel,
  delta,
  goodDirection = "up",
  series,
  href,
  module,
  emphasis = false,
}: {
  label: string;
  value: string;
  sublabel?: string;
  /** Percent change against the prior period; null when there is no prior. */
  delta?: number | null;
  goodDirection?: "up" | "down";
  series?: number[];
  href?: string;
  /** Drives the sparkline colour, so a figure matches its module everywhere. */
  module?: "sales" | "finance" | "delivery" | "service" | "partners";
  /** The one figure that answers the view's main question. */
  emphasis?: boolean;
}) {
  const good =
    delta === null || delta === undefined || delta === 0
      ? null
      : goodDirection === "up"
        ? delta > 0
        : delta < 0;

  const body = (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-xl border bg-card p-4 transition-shadow",
        href && "hover:border-primary/30 hover:shadow-sm",
      )}
    >
      {module && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: `var(--module-${module})` }}
        />
      )}

      <p className={cn("text-xs font-medium uppercase tracking-wide text-muted-foreground", module && "pl-1.5")}>
        {label}
      </p>

      <div className={cn("mt-1.5 flex items-baseline gap-2", module && "pl-1.5")}>
        <span className={cn("font-semibold tabular-nums tracking-tight", emphasis ? "text-3xl" : "text-2xl")}>
          {value}
        </span>

        {delta !== null && delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
              // Status colour is reserved for state and always paired with an
              // arrow, so direction never rests on colour alone.
              good === null
                ? "text-muted-foreground"
                : good
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400",
            )}
          >
            {delta === 0 ? (
              <Minus className="h-3 w-3" />
            ) : delta > 0 ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            )}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>

      {sublabel && (
        <p className={cn("mt-0.5 text-xs text-muted-foreground", module && "pl-1.5")}>{sublabel}</p>
      )}

      {series && series.length > 0 && (
        <div className="mt-3">
          <Sparkline values={series} height={28} tone={good === false ? "danger" : "primary"} />
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * A ranked list — who is at the top, and by how far.
 *
 * The bar is the point. A column of numbers makes the reader do the comparison;
 * a bar does it for them, which is the whole reason to draw one. Rows are capped
 * because a leaderboard past the first handful stops being a ranking and starts
 * being a table.
 */
export function RankedList({
  title,
  rows,
  emptyText,
  module = "sales",
  limit = 5,
}: {
  title: string;
  rows: { id: string; label: string; sublabel?: string; value: number; display: string; href?: string }[];
  emptyText: string;
  module?: "sales" | "finance" | "delivery" | "service" | "partners";
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  // Scaled to the leader rather than the total: the question is "who is ahead",
  // and against a total every bar in a long tail looks identically tiny.
  const max = Math.max(...shown.map((r) => r.value), 1);

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y">
          {shown.map((row) => {
            const share = (row.value / max) * 100;
            const inner = (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">{row.label}</span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">{row.display}</span>
                </div>
                {row.sublabel && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.sublabel}</p>
                )}
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, share)}%`,
                      backgroundColor: `var(--module-${module})`,
                    }}
                  />
                </div>
              </>
            );

            return (
              <li key={row.id} className="px-4 py-2.5">
                {row.href ? (
                  <Link href={row.href} className="block hover:underline">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The things that need a decision today.
 *
 * Kept separate from the figures above it because it is a different kind of
 * information: a KPI is a state to know, this is a queue to work. Empty is a
 * result worth stating plainly rather than hiding — "nothing needs you" is the
 * answer someone opening a dashboard hopes for.
 */
export function AttentionList({
  items,
}: {
  items: { id: string; count: number; title: string; detail?: string; href: string; tone: "warning" | "critical" }[];
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                  item.tone === "critical"
                    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
                )}
              >
                {item.count}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{item.title}</span>
                {item.detail && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {item.detail}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
