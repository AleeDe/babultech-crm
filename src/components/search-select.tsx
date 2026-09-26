"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchOption {
  value: string;
  label: string;
  /** Quieter text beside the label: a code, a date range. Also searched. */
  hint?: string;
}

/**
 * A dropdown you can type into.
 *
 * For short lists held in the page - a price book, the catalogue - where a plain
 * <select> makes somebody scroll twenty items for "Data Import/Export". Longer
 * lists that live on the server use RecordLookup instead, which searches there.
 *
 * Matches anywhere in the label or the hint, so "S-00001" finds a service by
 * its code and "import" finds "Data Import/Export".
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  disabled,
  ariaLabel,
  className,
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function choose(option: SearchOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Enter chooses rather than submitting the surrounding form.
      e.preventDefault();
      if (open && matches[active]) choose(matches[active]);
      else setOpen(true);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapper} className={cn("relative", className)}>
      <div
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-text",
          open && "ring-2 ring-ring",
        )}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          input.current?.focus();
        }}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          value={open ? query : selected ? `${selected.label}${selected.hint ? ` (${selected.hint})` : ""}` : ""}
          placeholder={selected && !open ? "" : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => !disabled && setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>

      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover py-1 text-sm shadow-md"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">Nothing matches.</li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5",
                  i === active && "bg-accent",
                  o.value === value && "font-medium",
                )}
              >
                <span>{o.label}</span>
                {o.hint && <span className="font-mono text-xs text-muted-foreground">{o.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
