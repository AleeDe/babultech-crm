"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { resolveLookup, searchLookup } from "@/server/lookups";
import {
  LOOKUP_HREF, LOOKUP_PLACEHOLDER,
  type LookupEntity, type LookupFilters, type LookupRecord,
} from "@/lib/lookups";

/**
 * A reference field: search for a record, choose one.
 *
 * Replaces the <select> that listed every account, contact or project. Those
 * work for ten rows and fail quietly at several hundred - the list is rendered
 * whole, and nobody finds "Sapphire Textiles" by scrolling. Here the matching
 * happens on the server, under the same permissions and scope as the list
 * screens, and only what matched comes back.
 *
 * It submits through a hidden input carrying the chosen id, so a form that used
 * a <select name="accountId"> keeps working untouched.
 *
 * Chosen records carry a link to their own page: a reference field is where
 * someone realises they need to look at the thing they are referring to.
 */
export function RecordLookup({
  entity,
  name,
  value,
  onChange,
  initial,
  defaultValue,
  filters,
  placeholder,
  emptyLabel = "None",
  required,
  disabled,
  allowClear = true,
  autoFocus,
}: {
  entity: LookupEntity;
  /** Form field name. The chosen id is submitted under it. */
  name?: string;
  /** Controlled id, when the parent tracks the selection. */
  value?: string | null;
  onChange?: (id: string | null, record: LookupRecord | null) => void;
  /**
   * The record already referenced. Optional: given only an id, the field asks
   * the server what it is called, so a page does not have to fetch a label for
   * every reference it renders.
   */
  initial?: LookupRecord | null;
  /** The id already stored, when the parent has no label for it. */
  defaultValue?: string | null;
  filters?: LookupFilters;
  placeholder?: string;
  /** What the field says when nothing is chosen. */
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  allowClear?: boolean;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<LookupRecord | null>(initial ?? null);
  const [resolving, setResolving] = useState(false);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<LookupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);

  // A controlled parent can clear or change the selection underneath us.
  useEffect(() => {
    if (value === undefined) return;
    if (!value) setSelected(null);
    else if (value !== selected?.id && initial?.id === value) setSelected(initial);
  }, [value, initial, selected?.id]);

  const currentId = value !== undefined ? (value ?? "") : (selected?.id ?? defaultValue ?? "");

  // A field given an id but no label names it once, on mount.
  useEffect(() => {
    const id = value ?? defaultValue ?? null;
    if (!id || selected?.id === id || initial?.id === id) return;
    let cancelled = false;
    setResolving(true);
    resolveLookup(entity, [id])
      .then((rows) => { if (!cancelled && rows[0]) setSelected(rows[0]); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [entity, value, defaultValue, initial?.id, selected?.id]);
  const filterKey = JSON.stringify(filters ?? {});

  // Search as they type, after a pause. The pause is what keeps one query per
  // word rather than one per keystroke.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await searchLookup(entity, term, filters ?? {});
        if (!cancelled) {
          setResults(rows);
          setHighlight(0);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Could not search. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, term ? 200 : 0);

    return () => { cancelled = true; clearTimeout(timer); };
    // filterKey rather than filters: a fresh object every render would search
    // in a loop.
  }, [entity, term, open, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicking away closes the list without choosing anything.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function choose(record: LookupRecord | null) {
    setSelected(record);
    setOpen(false);
    setTerm("");
    onChange?.(record?.id ?? null, record);
  }

  const href = selected ? LOOKUP_HREF[entity]?.(selected.id) : null;

  return (
    <div ref={boxRef} className="relative">
      {name && <input type="hidden" name={name} value={currentId} />}

      {!open ? (
        <div
          className={cn(
            "flex min-h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => { setOpen(true); setTerm(""); }}
            className="flex flex-1 items-center gap-2 text-left"
            aria-haspopup="listbox"
            aria-expanded={false}
          >
            {resolving && !selected ? (
              <span className="text-muted-foreground">Loading…</span>
            ) : selected ? (
              <span className="truncate">
                {selected.label}
                {selected.sublabel && (
                  <span className="ml-2 text-xs text-muted-foreground">{selected.sublabel}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">{emptyLabel}</span>
            )}
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
          </button>

          {href && (
            <Link
              href={href}
              title={`Open ${selected?.label}`}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="sr-only">Open {selected?.label}</span>
            </Link>
          )}

          {selected && allowClear && !required && !disabled && (
            <button
              type="button"
              onClick={() => choose(null)}
              title="Clear"
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Clear</span>
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus={autoFocus ?? true}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={placeholder ?? LOOKUP_PLACEHOLDER[entity]}
            className="pl-9"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((i) => Math.min(i + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)); }
              // Enter picks the highlighted row; without preventDefault it would
              // submit the form the field sits in.
              if (e.key === "Enter") { e.preventDefault(); if (results[highlight]) choose(results[highlight]); }
              if (e.key === "Escape") { e.preventDefault(); setOpen(false); setTerm(""); }
            }}
          />
          {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}

          <ul
            id={listId}
            role="listbox"
            // bg-card, not bg-popover: this theme defines no popover colour, so
            // that class left the list transparent and the page showed through.
            className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-card p-1 shadow-lg"
          >
            {error && <li className="px-3 py-2 text-sm text-destructive">{error}</li>}

            {!error && results.length === 0 && !loading && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {term ? `Nothing matches "${term}".` : "Nothing to choose from yet."}
              </li>
            )}

            {results.map((record, i) => (
              <li key={record.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={record.id === currentId}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(record)}
                  className={cn(
                    "flex w-full flex-col items-start rounded px-3 py-2 text-left text-sm",
                    i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  )}
                >
                  <span className="font-medium">{record.label}</span>
                  {record.sublabel && (
                    <span className="text-xs text-muted-foreground">{record.sublabel}</span>
                  )}
                </button>
              </li>
            ))}

            {results.length > 0 && (
              <li className="border-t px-3 py-1.5 text-xs text-muted-foreground">
                Keep typing to narrow these down.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
