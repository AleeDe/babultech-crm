"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A collapsible section of the guide.
 *
 * The guide was a single 1,900-word page: everything expanded, nothing
 * prioritised, and a reader looking for one answer had to scan all of it.
 * That is a working-memory problem, not a writing problem — the words were
 * fine, there were simply too many of them visible at once.
 *
 * Collapsed by default except the first, so the page opens as a short list of
 * questions rather than a wall of prose. Progressive disclosure: the summary
 * is enough to choose, the body is there when chosen.
 *
 * Native <details> rather than state-driven show/hide, so it works before
 * hydration, prints expanded, and Ctrl+F finds text inside a closed section —
 * which is how people actually search a page.
 */
export function GuideSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className="overflow-hidden">
      <details
        open={defaultOpen}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-3 p-5 transition-colors hover:bg-muted/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          )}
        >
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{summary}</p>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </summary>

        <CardContent className="border-t pt-5">{children}</CardContent>
      </details>
    </Card>
  );
}
