import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * What the mail provider tells us happened to a campaign email.
 *
 * This is a public endpoint, so the signature check is the whole of its
 * security. Resend signs with Svix headers: an id, a timestamp and one or more
 * base64 signatures over `id.timestamp.body`, keyed by a secret that starts
 * `whsec_`. Verified here by hand rather than with the Svix library, which is
 * a dependency for ninety lines of HMAC.
 *
 * Without RESEND_WEBHOOK_SECRET set, every request is refused. An unverified
 * endpoint that writes to the database is an invitation to have anyone's
 * campaign statistics filled in by a stranger.
 */

/** Five minutes, to bound how long a captured request stays replayable. */
const TOLERANCE_SECONDS = 300;

function verify(secret: string, id: string, timestamp: string, body: string, header: string): boolean {
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  // The secret is base64 after its prefix.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");

  // The header carries space-separated "v1,<signature>" pairs; a rotation
  // period has more than one, and any of them matching is a pass.
  for (const part of header.split(" ")) {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) continue;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Which timestamp column each event fills in. */
const EVENT_COLUMN: Record<string, string> = {
  "email.sent": "sentAt",
  "email.delivered": "deliveredAt",
  "email.opened": "openedAt",
  "email.clicked": "clickedAt",
  "email.bounced": "bouncedAt",
  "email.complained": "complainedAt",
};

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhooks are not configured." }, { status: 503 });
  }

  const body = await request.text();
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");

  if (!id || !timestamp || !signature || !verify(secret, id, timestamp, body, signature)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let event: { type?: string; data?: { email_id?: string; to?: string[] } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Not JSON." }, { status: 400 });
  }

  const column = EVENT_COLUMN[event.type ?? ""];
  const messageId = event.data?.email_id;

  // Anything we do not track is accepted rather than refused: a non-2xx makes
  // the provider retry forever over an event we were never going to store.
  if (!column || !messageId) return NextResponse.json({ ok: true });

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: row } = await db
    .from("campaign_activity_member")
    .select("id, memberId, openCount, clickCount, openedAt, clickedAt")
    .eq("providerMessageId", messageId)
    .maybeSingle();

  if (!row) return NextResponse.json({ ok: true });

  const update: Record<string, unknown> = { updatedAt: now };

  // The first time is what the date records; the count records every time.
  // Somebody who opens a message four times is more interested than somebody
  // who opened it once, and one timestamp cannot say so.
  if (column === "openedAt") {
    update.openedAt = row.openedAt ?? now;
    update.openCount = (row.openCount ?? 0) + 1;
  } else if (column === "clickedAt") {
    update.clickedAt = row.clickedAt ?? now;
    update.clickCount = (row.clickCount ?? 0) + 1;
    // A click implies an open that the pixel may well have missed.
    update.openedAt = row.openedAt ?? now;
  } else {
    update[column] = now;
  }

  await db.from("campaign_activity_member").update(update).eq("id", row.id);

  // A hard bounce or a spam complaint is about the address, not this one send:
  // both must stop future campaigns reaching it, or the domain's reputation
  // goes and the invoices stop arriving too.
  if (event.type === "email.bounced") {
    await db
      .from("campaign_member")
      .update({ emailBounced: true, updatedAt: now })
      .eq("id", row.memberId);
  }
  if (event.type === "email.complained") {
    await db
      .from("campaign_member")
      .update({
        emailOptOut: true,
        emailOptOutAt: now,
        emailOptOutReason: "Reported an email as spam",
        updatedAt: now,
      })
      .eq("id", row.memberId);
  }

  return NextResponse.json({ ok: true });
}
