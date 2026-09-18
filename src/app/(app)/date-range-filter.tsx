"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar } from "lucide-react";
import { Select, Input, Button } from "@/components/ui";
import { RANGE_PRESETS, MAX_N_DAYS, type DateRange, type RangePreset } from "@/lib/date-range";

/**
 * The dashboard's period control.
 *
 * The range lives in the URL rather than in component state, so a filtered
 * dashboard is a link someone can send — "here is last quarter, look at the
 * margin" — and the back button steps through the periods you looked at.
 *
 * Presets apply on change, because picking "Last week" is a complete thought.
 * The two that are not complete — Last N days and a custom from/to — reveal
 * their own inputs and an Apply button, since navigating on every keystroke
 * would fire a query per digit typed and fight the person entering a date.
 *
 * Not a `<form>`: every screen renders inside AppShell, a client component, so
 * React 19 would dispatch a submit as a Server Action and POST it — which, on
 * this app, logs the user out. See src/components/filter-form.tsx for the whole
 * account of that.
 */
export function DateRangeFilter({ range, showSummary = true }: { range: DateRange; showSummary?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Local copies so typing does not navigate on every keystroke.
  const [days, setDays] = useState(String(range.days ?? 30));
  const [from, setFrom] = useState(range.from ?? "");
  const [to, setTo] = useState(range.to ?? "");

  const push = (next: URLSearchParams) => {
    // The view tab is a separate concern and has to survive a range change.
    for (const key of ["view", "resource", "project", "projectStatus", "health"]) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const selectPreset = (preset: RangePreset) => {
    // These two need their own inputs filled in before they mean anything, so
    // changing to them only reveals the inputs — it does not navigate yet.
    if (preset === "last_n_days" || preset === "custom") {
      const next = new URLSearchParams();
      next.set("range", preset);
      if (preset === "last_n_days") next.set("days", days || "30");
      else if (from && to) { next.set("from", from); next.set("to", to); }
      push(next);
      return;
    }
    const next = new URLSearchParams();
    next.set("range", preset);
    push(next);
  };

  const applyDays = () => {
    // `Number(days) || 30` would read a typed 0 as "nothing entered" and jump
    // to 30 rather than clamping to the minimum, so the parse and the fallback
    // are kept apart: anything non-numeric is absent, anything numeric clamps.
    const parsed = Number(days);
    const n = Number.isFinite(parsed) && days.trim() !== ""
      ? Math.min(Math.max(Math.trunc(parsed), 1), MAX_N_DAYS)
      : 30;
    setDays(String(n));
    const next = new URLSearchParams();
    next.set("range", "last_n_days");
    next.set("days", String(n));
    push(next);
  };

  const applyCustom = () => {
    if (!from || !to) return;
    const next = new URLSearchParams();
    next.set("range", "custom");
    next.set("from", from);
    next.set("to", to);
    push(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Date range"
        className="h-9 w-[10.5rem]"
        value={range.preset}
        onChange={(e) => selectPreset(e.target.value as RangePreset)}
      >
        {RANGE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </Select>

      {range.preset === "last_n_days" && (
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">Last</span>
          <Input
            type="number"
            min={1}
            max={MAX_N_DAYS}
            aria-label="Number of days"
            className="h-9 w-20"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyDays(); } }}
          />
          <span className="text-sm text-muted-foreground">days</span>
          <Button type="button" variant="secondary" size="sm" onClick={applyDays}>Apply</Button>
        </div>
      )}

      {range.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="date"
            aria-label="From date"
            className="h-9 w-[9.5rem]"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCustom(); } }}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            className="h-9 w-[9.5rem]"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCustom(); } }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={applyCustom}
            disabled={!from || !to}
          >
            Apply
          </Button>
        </div>
      )}

      {showSummary && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Calendar className="h-3.5 w-3.5" aria-hidden />
        {range.label}
      </span>}
    </div>
  );
}
