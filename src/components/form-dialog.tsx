"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A centred modal for a form that has nowhere sensible to live inline.
 *
 * The board is a five-column grid, so a column is roughly 250px on a normal
 * screen. A ten-field form rendered inside one was unusable: the selects
 * clipped their own values ("Unassi", "No ph", "Mediu"), every label wrapped
 * onto two lines, and the form pushed the rest of the column's cards far below
 * the fold. Worse, the form's own `sm:grid-cols-2` made it *actively* wrong —
 * `sm:` is a viewport breakpoint, so on a wide screen it forced two columns
 * into 250px regardless of how little room the container actually had.
 *
 * Editing a card therefore happens here instead, which is what every board
 * product does — Jira, Linear, Trello, Asana all open a card's detail in a
 * modal or a side panel rather than expanding it in place. The board keeps its
 * shape while you type, and the form gets a width it was designed for.
 *
 * Scrolling is on the body rather than the page: the header and the form's own
 * buttons stay put on a short screen, so Save is never scrolled out of reach.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Optional context under the title — what is being edited, and where. */
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            // Pinned near the top rather than vertically centred: a form that
            // grows as it validates would otherwise shift under the cursor.
            "fixed left-1/2 top-[6%] z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-2xl",
            "-translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-card shadow-2xl",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 truncate text-sm text-muted-foreground">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
