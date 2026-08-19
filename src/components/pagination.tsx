import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Page navigation for a list.
 *
 * Links rather than buttons, so the page lives in the URL alongside the
 * filters: a page can be bookmarked and shared, the back button steps back
 * through pages, and none of it needs JavaScript.
 *
 * Every existing query parameter is carried through — dropping `search` or
 * `approvalStatus` when paging would silently widen the result set the user is
 * halfway through reading.
 */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  params = {},
  className,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  /** The current query string, minus `page`. */
  params?: Record<string, string | undefined>;
  className?: string;
}) {
  if (total === 0) return null;

  const href = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `?${qs}` : "?";
  };

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3",
        className,
      )}
    >
      {/* aria-live so a screen reader hears the new range after following a
          page link, which is otherwise a silent content swap. */}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing <span className="font-medium text-foreground tabular">{first}</span>–
        <span className="font-medium text-foreground tabular">{last}</span> of{" "}
        <span className="font-medium text-foreground tabular">{total}</span>
      </p>

      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <PageLink href={href(page - 1)} disabled={page <= 1} label="Previous page">
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Previous</span>
          </PageLink>

          {pageNumbers(page, pageCount).map((entry, index) =>
            entry === "gap" ? (
              <span key={`gap-${index}`} className="px-1 text-sm text-muted-foreground" aria-hidden>
                …
              </span>
            ) : (
              <Link
                key={entry}
                href={href(entry)}
                aria-label={`Page ${entry}`}
                aria-current={entry === page ? "page" : undefined}
                className={cn(
                  "grid h-8 min-w-8 place-items-center rounded-md px-2 text-sm tabular transition-colors",
                  entry === page
                    ? "bg-primary font-medium text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {entry}
              </Link>
            ),
          )}

          <PageLink href={href(page + 1)} disabled={page >= pageCount} label="Next page">
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="h-4 w-4" />
          </PageLink>
        </div>
      )}
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const classes =
    "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm transition-colors";

  // A disabled control must not be focusable or followable, and <a> has no
  // disabled attribute — so it degrades to a span rather than a dead link.
  if (disabled) {
    return (
      <span aria-disabled className={cn(classes, "cursor-not-allowed opacity-40")}>
        {children}
      </span>
    );
  }

  return (
    <Link href={href} aria-label={label} className={cn(classes, "hover:bg-accent")}>
      {children}
    </Link>
  );
}

/**
 * Window of page numbers: always the first and last, the current and its
 * neighbours, and an ellipsis across any jump. Keeps the control a fixed width
 * whether there are 3 pages or 300.
 */
function pageNumbers(current: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);

  const pages = new Set<number>([1, count, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);

  const out: (number | "gap")[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) out.push("gap");
    out.push(page);
    previous = page;
  }
  return out;
}
