"use client";

import { useState, useId, useRef, useEffect } from "react";
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
 */
export function FieldHelp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span
      ref={wrapper}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
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

      {open && (
        <span
          id={id}
          role="tooltip"
          // Anchored to the marker's left edge rather than centred on it.
          // Centring pushed the bubble off-screen for any field in the left
          // column, because half its width sat outside the form.
          //
          // bg-card, not bg-popover: this project defines no popover token, so
          // that class produced no background at all and the page text showed
          // straight through the bubble.
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-max max-w-[min(20rem,calc(100vw-3rem))] rounded-md border bg-card px-3 py-2 text-xs font-normal leading-relaxed text-card-foreground shadow-lg"
        >
          {text}
          {/* Two triangles, the outer one a pixel lower, so the arrow carries
              the same border as the bubble instead of floating unattached. */}
          <span
            aria-hidden
            className="absolute left-3 top-full -ml-1 border-[5px] border-transparent border-t-border"
          />
          <span
            aria-hidden
            className="absolute left-3 top-full -ml-1 -mt-px border-[5px] border-transparent border-t-card"
          />
        </span>
      )}
    </span>
  );
}
