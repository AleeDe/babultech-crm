/**
 * The currencies money is shown in, and the rates between them.
 *
 * Held in module state rather than threaded through every call, because money is
 * formatted in close to three hundred places across fifty-five files. Passing a
 * context to each would have meant editing every one of them, and missing one
 * would show a single currency with no sign anything was wrong.
 *
 * Safe as module state only because this is a single-organisation system: the
 * currencies and rates are the same for every request and every user. It is set
 * on the server by ensureCurrencyContext() before any page renders, and in the
 * browser by <CurrencyContextProvider> from the same values - so the two render
 * identical text and hydrate cleanly.
 */

export interface CurrencyContext {
  /** Every calculation happens in this currency. */
  defaultCurrency: string;
  /** Shown alongside for reference. Never calculated in. */
  corporateCurrency: string;
  /** How many units of the base currency (PKR) one unit of each buys. */
  rates: Record<string, number>;
}

let current: CurrencyContext | null = null;

export function setCurrencyContext(ctx: CurrencyContext | null): void {
  current = ctx;
}

export function getCurrencyContext(): CurrencyContext | null {
  return current;
}

/**
 * Converts through the base currency: into it at one rate, out at the other.
 * Returns null when either rate is unknown, so the caller shows nothing rather
 * than a figure calculated from a missing rate.
 */
export function convert(amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  const ctx = current;
  if (!ctx) return null;
  const fromRate = ctx.rates[from];
  const toRate = ctx.rates[to];
  if (!fromRate || !toRate) return null;
  return (amount * fromRate) / toRate;
}

/**
 * Which currency to show a figure in alongside its own.
 *
 * The corporate currency, unless the figure is already in it - then the default
 * currency, so a USD amount still shows what it is in PKR. Null when there is
 * nothing useful to add.
 */
export function companionCurrency(currency: string): string | null {
  const ctx = current;
  if (!ctx) return null;
  if (currency !== ctx.corporateCurrency) return ctx.corporateCurrency;
  if (currency !== ctx.defaultCurrency) return ctx.defaultCurrency;
  return null;
}
