"use client";

import { setCurrencyContext, type CurrencyContext } from "@/lib/currency-context";

/**
 * Hands the browser the same currencies and rates the server just used.
 *
 * Set during render rather than in an effect, and before its children render,
 * so the very first client render formats money exactly as the server did. An
 * effect would run after the children, and for one render the browser would
 * show one currency where the server showed two - a hydration mismatch.
 */
export function CurrencyContextProvider({
  value,
  children,
}: {
  value: CurrencyContext;
  children: React.ReactNode;
}) {
  setCurrencyContext(value);
  return <>{children}</>;
}
