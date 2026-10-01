import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { WEBHOOK_RETRY_MINUTES } from "@/lib/webhook-events";

/**
 * Posts due webhook deliveries (integration_log rows), a runner chore.
 *
 * Each body is signed: X-BabulTech-Signature is "sha256=" and the hex HMAC of
 * "<timestamp>.<body>" with the webhook's secret, and X-BabulTech-Timestamp is
 * that timestamp, so a receiver can check the call is ours and is fresh.
 */

interface Delivery {
  id: string;
  webhookId: string | null;
  event: string;
  endpoint: string | null;
  payload: unknown;
  attempts: number;
}

/** Signs a body the way receivers verify it. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/**
 * Refuses addresses inside a private network: a webhook is an administrator's
 * setting, but it should still never reach the server's own neighbours.
 * WEBHOOK_ALLOW_PRIVATE=1 lifts this for local testing.
 */
export function isPrivateAddress(url: string): boolean {
  if (process.env.WEBHOOK_ALLOW_PRIVATE === "1") return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return true;
  }
  return (
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host === "::1" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^0\./.test(host) || /^f[cd][0-9a-f]{2}:/.test(host)
  );
}

export async function deliverWebhooks(deadline: number): Promise<number> {
  const db = supabaseAdmin();
  let processed = 0;
  while (Date.now() < deadline - 12_000) {
    const { data, error } = await db.rpc("claim_webhook_deliveries", { p_limit: 5 });
    if (error) throw new Error(`Could not claim webhook deliveries: ${error.message}`);
    const batch = (data ?? []) as Delivery[];
    if (!batch.length) break;

    const ids = [...new Set(batch.map((d) => d.webhookId).filter(Boolean))] as string[];
    const { data: hooks } = await db.from("webhook").select("id, url, secret, active").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((hooks ?? []).map((h) => [h.id as string, h as { id: string; url: string; secret: string; active: boolean }]));

    for (const d of batch) {
      processed += 1;
      const hook = d.webhookId ? byId.get(d.webhookId) : undefined;
      if (!hook || !hook.active) {
        await db.from("integration_log").update({ status: "GAVE_UP", errorMessage: "The webhook was removed or switched off.", nextAttemptAt: null }).eq("id", d.id);
        continue;
      }
      if (isPrivateAddress(hook.url)) {
        await db.from("integration_log").update({ status: "GAVE_UP", errorMessage: "Private network addresses are not allowed.", nextAttemptAt: null }).eq("id", d.id);
        continue;
      }

      const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const started = Date.now();
      let httpStatus: number | null = null;
      let responseBody: string | null = null;
      let failure: string | null = null;
      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "BabulTech-CRM-Webhooks/1.0",
            "x-babultech-event": d.event,
            "x-babultech-delivery": d.id,
            "x-babultech-timestamp": timestamp,
            "x-babultech-signature": signWebhook(hook.secret, timestamp, body),
          },
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        httpStatus = res.status;
        responseBody = (await res.text().catch(() => "")).slice(0, 1000);
        if (res.status < 200 || res.status >= 300) failure = `The receiver answered ${res.status}.`;
      } catch (err) {
        failure = err instanceof Error ? (err.name === "TimeoutError" ? "No answer within 10 seconds." : err.message) : String(err);
      }

      const finished = { httpStatus, responseBody, responseAt: new Date().toISOString(), durationMs: Date.now() - started };
      if (!failure) {
        await db.from("integration_log").update({ ...finished, status: "SUCCESS", errorMessage: null, nextAttemptAt: null }).eq("id", d.id);
      } else {
        const wait = WEBHOOK_RETRY_MINUTES[d.attempts - 1];
        await db.from("integration_log").update({
          ...finished,
          status: wait === undefined ? "GAVE_UP" : "FAILED",
          errorMessage: failure,
          nextAttemptAt: wait === undefined ? null : new Date(Date.now() + wait * 60_000).toISOString(),
        }).eq("id", d.id);
      }
    }
  }
  return processed;
}
