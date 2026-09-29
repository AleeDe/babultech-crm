import { headers } from "next/headers";
import { after } from "next/server";
import { supabaseAdmin } from "./supabase";

/**
 * The scheduler needs the site's public address to call /api/jobs/run
 * (see the background jobs migration). Rather than wait for an administrator
 * to type it, the first request the live site serves records the address it
 * was reached at. Only when nothing is set, only for an https address that is
 * not this computer or a temporary tunnel - so a developer's machine never
 * points the shared scheduler at itself - and never over an address an
 * administrator chose. Checked once per server process.
 */

let settled = false;

const NOT_PUBLIC = /(^|\.)(localhost|trycloudflare\.com|ngrok(-free)?\.(app|io)|local)$|^127\.|^10\.|^192\.168\./i;

export async function rememberSchedulerAddress(): Promise<void> {
  if (settled) return;
  let host: string | null = null;
  let proto: string | null = null;
  try {
    const h = await headers();
    host = (h.get("x-forwarded-host") ?? h.get("host"))?.split(":")[0] ?? null;
    proto = h.get("x-forwarded-proto");
  } catch {
    return;
  }
  if (!host || proto !== "https" || NOT_PUBLIC.test(host)) return;
  const address = `https://${host}`;

  const run = async () => {
    const db = supabaseAdmin();
    const { data } = await db.from("company_setting").select("publicAppUrl").eq("id", true).maybeSingle();
    if (data && !data.publicAppUrl) {
      await db.from("company_setting").update({ publicAppUrl: address }).eq("id", true).is("publicAppUrl", null);
    }
    settled = true;
  };
  try {
    after(() => run().catch(() => {}));
  } catch {
    /* Outside a request. */
  }
}
