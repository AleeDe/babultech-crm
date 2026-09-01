"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Input } from "@/components/ui";

/**
 * A start/end date pair that will not let you pick an end before the start.
 *
 * Both dates were plain inputs with no relationship between them. The server
 * does refuse an inverted range — createCampaign returns "The campaign cannot
 * end before it starts." — but only once the whole form has been filled in and
 * submitted, which is the worst moment to find out. Here the browser's own date
 * picker greys out the impossible days as soon as a start date exists.
 *
 * The server check stays exactly as it is. This is a convenience, not the
 * boundary: `min` is trivially bypassed by editing the DOM, and a paste can
 * fill a field without ever opening a picker.
 *
 * Split into a provider and two inputs rather than one component that renders
 * both, because each date carries its own label and help text inside its own
 * FormField — a component owning both would have to reproduce that layout and
 * would drift from every other field on the form.
 */
const RangeContext = createContext<{
  start: string;
  end: string;
  setStart: (v: string) => void;
  setEnd: (v: string) => void;
} | null>(null);

export function DateRange({
  startDefault = "",
  endDefault = "",
  children,
}: {
  startDefault?: string;
  endDefault?: string;
  children: ReactNode;
}) {
  const [start, setStart] = useState(startDefault);
  const [end, setEnd] = useState(endDefault);
  return (
    <RangeContext.Provider value={{ start, end, setStart, setEnd }}>
      {children}
    </RangeContext.Provider>
  );
}

export function RangeStart({ name }: { name: string }) {
  const ctx = useContext(RangeContext);
  if (!ctx) throw new Error("RangeStart must be inside <DateRange>");
  return (
    <Input
      name={name}
      type="date"
      value={ctx.start}
      onChange={(e) => ctx.setStart(e.target.value)}
      // Bounded from above as well, so the conflict can be resolved from
      // either end rather than only by editing the date that came second.
      max={ctx.end || undefined}
    />
  );
}

export function RangeEnd({ name }: { name: string }) {
  const ctx = useContext(RangeContext);
  if (!ctx) throw new Error("RangeEnd must be inside <DateRange>");

  // Clearing an end date that has fallen behind a newly-chosen start would
  // discard something typed on purpose. The value is kept and flagged instead,
  // so the person can see the conflict and choose which date is wrong.
  const inverted = Boolean(ctx.start && ctx.end && ctx.end < ctx.start);

  return (
    <>
      <Input
        name={name}
        type="date"
        value={ctx.end}
        onChange={(e) => ctx.setEnd(e.target.value)}
        min={ctx.start || undefined}
        aria-invalid={inverted || undefined}
      />
      {inverted && (
        <p className="mt-1 text-xs text-destructive">
          Must be on or after the start date.
        </p>
      )}
    </>
  );
}
