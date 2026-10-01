import { cache } from "react";

/**
 * The time zone and date format dates are shown in, for the person reading.
 *
 * Unlike the currency context this is per person, so it cannot be plain module
 * state on the server - two people's requests run side by side. On the server
 * it lives in a box scoped to the request by React's cache(), filled by
 * requireUser(), which every page awaits before it renders a date. In the
 * browser there is only one person, so <DatePrefsProvider> sets it as module
 * state from the same values - the two render identical text.
 *
 * Outside a render (a server action, a route, an email) the box is empty and
 * dates fall back to the runtime's zone, as before.
 */

export type DateFormat = "DMY" | "MDY" | "YMD";

export interface DatePrefs {
  timeZone: string | null;
  dateFormat: DateFormat;
}

let clientPrefs: DatePrefs | null = null;

const requestBox = cache((): { prefs: DatePrefs | null } => ({ prefs: null }));

/** Server: the signed-in person's preferences, for the rest of this request. */
export function setRequestDatePrefs(prefs: DatePrefs): void {
  try {
    requestBox().prefs = prefs;
  } catch {
    /* Not inside a render - nothing to scope to. */
  }
}

/** Browser: from <DatePrefsProvider>. */
export function setClientDatePrefs(prefs: DatePrefs | null): void {
  clientPrefs = prefs;
}

export function currentDatePrefs(): DatePrefs | null {
  if (typeof window !== "undefined") return clientPrefs;
  try {
    return requestBox().prefs;
  } catch {
    return null;
  }
}

/** A real IANA zone the runtime knows, or null. */
export function validTimeZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}
