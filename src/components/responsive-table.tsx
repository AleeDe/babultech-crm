import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Column priority for narrow screens.
 *
 * A nine-column table on a 375px phone is a horizontal scroll nobody performs —
 * the reader sees column one and gives up. Rather than shrinking every column
 * until all are illegible, columns declare how important they are and the ones
 * that matter least drop out first.
 *
 *   primary   always visible — the thing being identified
 *   secondary from 640px  (sm)  — needed to tell two rows apart
 *   tertiary  from 1024px (lg)  — useful when scanning, not when finding
 *
 * This is progressive disclosure applied to a table: show what identifies a
 * row, and let the detail page carry the rest.
 */
export type ColumnPriority = "primary" | "secondary" | "tertiary";

const VISIBILITY: Record<ColumnPriority, string> = {
  primary: "",
  secondary: "hidden sm:table-cell",
  tertiary: "hidden lg:table-cell",
};

export function priorityClass(priority: ColumnPriority = "primary"): string {
  return VISIBILITY[priority];
}

/**
 * A row rendered as a card on phones and a table row on wider screens.
 *
 * Used where a list is read rather than compared — my work, approvals — since
 * a card can stack a label above its value and stays legible at any width.
 */
export function StackedRow({
  title,
  subtitle,
  badges,
  fields,
  href,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  /** Label/value pairs, shown beneath the title on a phone. */
  fields?: { label: string; value: ReactNode }[];
  href?: string;
  action?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {badges && <div className="flex shrink-0 flex-wrap gap-1.5">{badges}</div>}
      </div>

      {fields && fields.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {action && <div className="mt-3">{action}</div>}
    </>
  );

  return (
    <li
      className={cn(
        "border-b p-4 last:border-0",
        href && "transition-colors hover:bg-muted/50",
      )}
    >
      {body}
    </li>
  );
}
