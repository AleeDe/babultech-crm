"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, ArrowDownToLine, ArrowUpFromLine, AlertTriangle } from "lucide-react";
import { guideFor } from "@/lib/page-guides";
import { cn } from "@/lib/utils";

/**
 * "What is this screen, and where does it sit?" — one strip under the title.
 *
 * Almost nothing in this app stands alone: a quote exists because a deal does, a
 * contract because a quote was accepted, commission because a partner was
 * attached to a lead months earlier. Someone who cannot see that chain creates
 * records in the wrong order and then finds a dropdown empty, which has been
 * most of the confusion so far.
 *
 * Collapsed by default, and the choice is remembered. Open, it is the answer to
 * a question someone new asks constantly; closed, it costs one line. Forcing the
 * expanded version on someone who has used the screen a hundred times would make
 * the help itself the clutter — which is why this is disclosure rather than a
 * permanent panel.
 *
 * Deliberately not a modal or a tooltip. A modal interrupts the task to explain
 * it; a tooltip cannot hold three lists and disappears when the pointer moves.
 * An inline strip can be read alongside the thing it describes and left open
 * while working.
 */
export function PageGuide() {
  const pathname = usePathname();
  const guide = guideFor(pathname);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem("page-guide-open") === "1");
    } catch {
      // Private windows and blocked storage just get the closed default.
    }
  }, []);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        // One preference for all screens rather than per path: someone learning
        // the system wants them open everywhere, and someone who knows it wants
        // them gone everywhere.
        window.localStorage.setItem("page-guide-open", next ? "1" : "0");
      } catch {
        // As above.
      }
      return next;
    });
  }

  if (!guide) return null;

  return (
    <div className="-mt-2 mb-5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 rounded-md border border-dashed px-3 py-2 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
          {/* Closed, the purpose line is the whole point of the strip — it has
              to say something useful without being opened. */}
          {guide.purpose}
        </span>
      </button>

      {open && (
        <div className="mt-2 grid gap-4 rounded-md border bg-muted/20 p-4 sm:grid-cols-2">
          {guide.needs && (
            <Section
              icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
              title="What this needs first"
              items={guide.needs}
            />
          )}

          {guide.feeds && (
            <Section
              icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
              title="What it leads to"
              items={guide.feeds}
            />
          )}

          {guide.watchOut && (
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-500 sm:col-span-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{guide.watchOut}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-xs leading-relaxed text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
