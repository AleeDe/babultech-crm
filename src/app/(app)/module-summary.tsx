import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * One module's live figures, as a card.
 *
 * Each row is a link, because a number on a dashboard is only useful if you can
 * get to the records behind it. Rows flagged `alert` are the ones that mean
 * something is wrong rather than merely large.
 */
export interface SummaryRow {
  label: string;
  value: string;
  href: string;
  alert?: boolean;
  muted?: boolean;
}

export function ModuleSummary({
  title,
  icon: Icon,
  href,
  rows,
  headline,
}: {
  title: string;
  icon: LucideIcon;
  href: string;
  rows: SummaryRow[];
  headline?: { label: string; value: string };
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col p-0">
        <Link
          href={href}
          className="group flex items-center gap-2.5 border-b px-4 py-3 transition-colors hover:bg-muted/50"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <span className="flex-1 font-semibold">{title}</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>

        {headline && (
          <div className="border-b px-4 py-3">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{headline.value}</p>
            <p className="text-xs text-muted-foreground">{headline.label}</p>
          </div>
        )}

        <div className="flex-1 divide-y">
          {rows.map((row) => (
            <Link
              key={row.label}
              href={row.href}
              className="flex items-center justify-between gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/50"
            >
              <span className={cn("text-muted-foreground", row.muted && "opacity-60")}>
                {row.label}
              </span>
              <span
                className={cn(
                  "shrink-0 font-medium tabular-nums",
                  row.alert && "text-red-600 dark:text-red-400",
                )}
              >
                {row.value}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
