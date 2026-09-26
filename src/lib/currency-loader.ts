import { supabaseAdmin } from "@/lib/supabase";
import { setCurrencyContext, type CurrencyContext } from "@/lib/currency-context";

/**
 * Loads the company's currencies and rates into the formatting context.
 *
 * Read with the service client, because a partner signed into the portal cannot
 * read company_setting and would otherwise see money with no currencies known.
 * Nothing here is sensitive: it is which currencies we use and what they are
 * worth.
 *
 * Cached for a few minutes, and dropped at once when an administrator changes a
 * rate or a setting, so a change shows on the next page rather than eventually.
 */

const TTL_MS = 5 * 60 * 1000;

let loaded: { ctx: CurrencyContext; at: number } | null = null;
let inflight: Promise<CurrencyContext> | null = null;

async function load(): Promise<CurrencyContext> {
  const db = supabaseAdmin();

  const [{ data: setting }, { data: currencies }] = await Promise.all([
    db.from("company_setting").select("defaultCurrency, corporateCurrency").maybeSingle(),
    db.from("currency").select("code, exchangeRate").eq("active", true),
  ]);

  const rates: Record<string, number> = {};
  for (const c of currencies ?? []) {
    const rate = Number(c.exchangeRate);
    if (rate > 0) rates[String(c.code).trim()] = rate;
  }

  return {
    defaultCurrency: String(setting?.defaultCurrency ?? "PKR").trim(),
    corporateCurrency: String(setting?.corporateCurrency ?? "USD").trim(),
    rates,
  };
}

/**
 * Makes sure the context is loaded and current, and returns it.
 *
 * Called from requireUser(), which every page awaits before rendering anything,
 * so by the time a page formats an amount the rates are already in place.
 */
export async function ensureCurrencyContext(): Promise<CurrencyContext> {
  if (loaded && Date.now() - loaded.at < TTL_MS) {
    setCurrencyContext(loaded.ctx);
    return loaded.ctx;
  }

  // One load for a burst of simultaneous requests, not one each.
  inflight ??= load().finally(() => {
    inflight = null;
  });

  try {
    const ctx = await inflight;
    loaded = { ctx, at: Date.now() };
    setCurrencyContext(ctx);
    return ctx;
  } catch {
    // A failed load must not take pages down with it. Money then shows in one
    // currency, which is correct if incomplete, until the next attempt.
    if (loaded) return loaded.ctx;
    const fallback: CurrencyContext = { defaultCurrency: "PKR", corporateCurrency: "USD", rates: {} };
    setCurrencyContext(fallback);
    return fallback;
  }
}

/** Forget the cached rates, so the next page reads them fresh. */
export function invalidateCurrencyContext(): void {
  loaded = null;
}
