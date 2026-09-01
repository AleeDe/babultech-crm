"use client";

import { useState, useId, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

/**
 * The "what goes in this field?" marker beside a form label.
 *
 * Hover alone is not enough. A hover-only tooltip is invisible to keyboard
 * users, unreachable on a touch screen, and gone the moment the pointer moves —
 * so this opens on hover, on focus and on click, and the button is a real
 * <button> in the tab order rather than an icon with a title attribute.
 *
 * `title` was the tempting shortcut and is the wrong tool: the browser decides
 * the delay and the styling, it never appears on touch, and screen readers
 * treat it inconsistently. `aria-describedby` pointing at the visible bubble is
 * what actually gets announced.
 *
 * Escape closes it, and so does clicking anywhere else — a tooltip that traps
 * the pointer to stay open is worse than one that never opened.
 *
 * The bubble is rendered in a portal on <body> rather than beside the marker.
 * An absolutely-positioned bubble is clipped by any ancestor with
 * `overflow: hidden`, and StatTile's card has exactly that — it needs it to clip
 * the accent bar to the rounded corner — so on a dashboard tile the help text
 * appeared as a sliver and nothing else. z-index cannot rescue that; only
 * leaving the clipping ancestor can. Position therefore comes from measuring
 * the button, not from CSS anchoring.
 */
export function FieldHelp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  /**
   * Measures the marker and decides where the bubble sits.
   *
   * Above by default, because that is out of the way of the value being
   * described. Flipped below when there is not room above — near the top of the
   * viewport the bubble would otherwise be cut off by the window itself, which
   * is the same failure in a different place.
   */
  const place = useCallback(() => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;

    const ESTIMATED_HEIGHT = 96; // Enough for the longest text at the narrow width.
    const below = rect.top < ESTIMATED_HEIGHT;

    setSpot({
      left: rect.left,
      top: below ? rect.bottom + 8 : rect.top - 8,
      below,
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    place();

    function onPointerDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    // Fixed positioning is relative to the viewport, so a scroll or resize
    // would otherwise leave the bubble behind while the marker moves away.
    function reposition() {
      place();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, place]);

  return (
    <span
      ref={wrapper}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={button}
        type="button"
        // Not "help for X": the label is already read out beside it, so naming
        // the field again makes the announcement stutter.
        aria-label="What goes in this field?"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Inside a <label>, a click would otherwise fall through and focus
          // the input, closing the bubble the same instant it opened.
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open &&
        spot &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{
              left: spot.left,
              top: spot.top,
              // Translated rather than offset in `top`, so the bubble can be
              // pinned by its bottom edge when sitting above the marker without
              // needing to know its own height first.
              transform: spot.below ? undefined : "translateY(-100%)",
              // Keeps a long bubble from running off the right of the window
              // when the marker is near the edge.
              maxWidth: `min(20rem, calc(100vw - ${spot.left}px - 1rem))`,
            }}
            // bg-card, not bg-popover: this project defines no popover token, so
            // that class produced no background at all and the page text showed
            // straight through the bubble.
            className="pointer-events-none fixed z-[100] w-max rounded-md border bg-card px-3 py-2 text-xs font-normal leading-relaxed text-card-foreground shadow-lg"
          >
            {text}
            {/* Two triangles, the outer one a pixel further out, so the arrow
                carries the same border as the bubble instead of floating
                unattached. It points back at the marker, so it swaps ends when
                the bubble flips below. */}
            <span
              aria-hidden
              className={
                spot.below
                  ? "absolute bottom-full left-3 -ml-1 border-[5px] border-transparent border-b-border"
                  : "absolute left-3 top-full -ml-1 border-[5px] border-transparent border-t-border"
              }
            />
            <span
              aria-hidden
              className={
                spot.below
                  ? "absolute bottom-full left-3 -ml-1 -mb-px border-[5px] border-transparent border-b-card"
                  : "absolute left-3 top-full -ml-1 -mt-px border-[5px] border-transparent border-t-card"
              }
            />
          </span>,
          document.body,
        )}
    </span>
  );
}
