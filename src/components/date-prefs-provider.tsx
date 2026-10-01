"use client";

import { setClientDatePrefs, type DatePrefs } from "@/lib/date-prefs";

/**
 * Hands the browser the time zone and date format the server just used, so
 * dates rendered in the browser read exactly as the server's did. Set during
 * render, before the children, for the same reason as CurrencyContextProvider.
 */
export function DatePrefsProvider({ value, children }: { value: DatePrefs; children: React.ReactNode }) {
  setClientDatePrefs(value);
  return <>{children}</>;
}
