"use client";

import { createContext, useContext } from "react";
import { humanize } from "@/lib/utils";
import type { PicklistKey, PicklistMap } from "@/lib/picklists";

const PicklistContext = createContext<PicklistMap>({});

/** Loaded once in the app layout; every form reads from it. */
export function PicklistProvider({ value, children }: { value: PicklistMap; children: React.ReactNode }) {
  return <PicklistContext.Provider value={value}>{children}</PicklistContext.Provider>;
}

/**
 * The options for one list, as configured in Settings.
 *
 * `fallback` is the form's old built-in list, used only if the configured list
 * is missing (not loaded, or the migration not applied yet). `current` is the
 * record's saved value: it is always offered, even if it has since been hidden
 * or removed, so editing a record never silently changes that field.
 */
export function usePicklist(
  key: PicklistKey,
  opts: {
    fallback?: readonly string[];
    current?: string | null;
    exclude?: readonly string[];
    /** Only these values, for forms that offer part of a workflow list. */
    within?: readonly string[];
  } = {},
): { value: string; label: string }[] {
  const map = useContext(PicklistContext);
  const configured = map[key];
  let options =
    configured && configured.length > 0
      ? configured
      : (opts.fallback ?? []).map((v) => ({ value: v, label: humanize(v) }));

  if (opts.exclude?.length) options = options.filter((o) => !opts.exclude!.includes(o.value));
  if (opts.within?.length) options = options.filter((o) => opts.within!.includes(o.value));

  const current = opts.current;
  if (current && !options.some((o) => o.value === current)) {
    options = [{ value: current, label: labelFrom(map, key, current) }, ...options];
  }
  return options;
}

/** The label for a stored value, for read-only display. */
export function usePicklistLabel(key: PicklistKey) {
  const map = useContext(PicklistContext);
  return (value: string | null | undefined) => (value ? labelFrom(map, key, value) : "—");
}

function labelFrom(map: PicklistMap, key: string, value: string) {
  return map[key]?.find((o) => o.value === value)?.label ?? (/^[A-Z0-9_]+$/.test(value) ? humanize(value) : value);
}

/** Drop-in replacement for `LIST.map((v) => <option ...>)` inside a <Select>. */
export function PicklistOptions(props: {
  list: PicklistKey;
  fallback?: readonly string[];
  current?: string | null;
  exclude?: readonly string[];
  within?: readonly string[];
}) {
  const options = usePicklist(props.list, props);
  return (
    <>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </>
  );
}
