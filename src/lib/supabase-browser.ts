"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client, for realtime only.
 *
 * The app reads and writes through server components and server actions; this
 * exists so the page can subscribe to Postgres change notifications and know
 * when the numbers it rendered have gone stale.
 *
 * It carries the same session cookie the server client uses, so realtime
 * respects RLS: a subscriber is only notified about rows they could have read.
 * That is only true when the publication is filtered by RLS, which Supabase
 * does for authenticated clients — never assume a payload is safe to render
 * without checking it came back through a normal read.
 *
 * One instance per tab. Every `createBrowserClient` call opens its own
 * websocket, and a component that builds one per render will exhaust the
 * connection limit.
 */
let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set for realtime.",
    );
  }

  client = createBrowserClient(url, anonKey, {
    realtime: {
      // The default of 10/second is meant for chat. A CRM produces a burst of
      // writes when someone saves a record with many lines, and there is no
      // value in delivering each one as its own repaint.
      params: { eventsPerSecond: 2 },
    },
  });

  return client;
}
