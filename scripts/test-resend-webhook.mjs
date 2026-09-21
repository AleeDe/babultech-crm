// Checks the Resend webhook endpoint without involving Resend.
//
// It signs a request exactly as Svix does and posts it, then does the same with
// a wrong secret, an old timestamp and no signature at all. That proves the two
// things worth proving before any real email goes out: a genuine event is
// accepted, and a forged one is not.
//
// It needs RESEND_WEBHOOK_SECRET set, because that is the thing being tested.
//
// Usage: node scripts/test-resend-webhook.mjs
//        node scripts/test-resend-webhook.mjs https://your-tunnel.trycloudflare.com
import { config } from "dotenv";
import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
config({ path: ".env", quiet: true });

const base = process.argv[2] ?? "http://localhost:3000";
const endpoint = `${base.replace(/\/$/, "")}/api/webhooks/resend`;
const secret = process.env.RESEND_WEBHOOK_SECRET;

if (!secret) {
  console.error("RESEND_WEBHOOK_SECRET is not set, so there is nothing to test.");
  console.error("Add it to .env, restart the dev server, and run this again.");
  process.exit(1);
}

const passed = [];
const pass = (n) => { passed.push(n); console.log(`PASS ${n}`); };

/** Signs a body the way Svix does: HMAC over id.timestamp.body. */
function sign(signingSecret, id, timestamp, body) {
  const key = Buffer.from(signingSecret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

async function post({ withSecret = secret, ageSeconds = 0, omitSignature = false, body }) {
  const id = `msg_${randomUUID().replace(/-/g, "")}`;
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  const headers = { "content-type": "application/json", "svix-id": id, "svix-timestamp": timestamp };

  if (!omitSignature) {
    headers["svix-signature"] = `v1,${sign(withSecret, id, timestamp, body)}`;
  }

  const response = await fetch(endpoint, { method: "POST", headers, body });
  return { status: response.status, text: await response.text() };
}

// An event for a message id that belongs to nobody. The endpoint should accept
// it and quietly do nothing — a non-2xx would make Resend retry forever over an
// event there was never anything to record.
const body = JSON.stringify({
  type: "email.opened",
  created_at: new Date().toISOString(),
  data: { email_id: randomUUID(), to: ["nobody@example.com"] },
});

console.log(`Testing ${endpoint}\n`);

try {
  const genuine = await post({ body });
  assert.equal(genuine.status, 200, `A correctly signed request should be accepted, got ${genuine.status}: ${genuine.text}`);
  pass("A correctly signed event is accepted");

  const wrongSecret = await post({ body, withSecret: "whsec_" + Buffer.from("not-the-secret").toString("base64") });
  assert.equal(wrongSecret.status, 401, `A wrong signature should be refused, got ${wrongSecret.status}`);
  pass("A request signed with the wrong secret is refused");

  const unsigned = await post({ body, omitSignature: true });
  assert.equal(unsigned.status, 401, `An unsigned request should be refused, got ${unsigned.status}`);
  pass("An unsigned request is refused");

  // Replay protection: a captured request stops working once it is old.
  const stale = await post({ body, ageSeconds: 600 });
  assert.equal(stale.status, 401, `A ten-minute-old request should be refused, got ${stale.status}`);
  pass("A stale request is refused, so a captured one cannot be replayed later");

  const tampered = await (async () => {
    const id = `msg_${randomUUID().replace(/-/g, "")}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(secret, id, timestamp, body);
    // Signed one body, sent another.
    const other = JSON.stringify({ type: "email.clicked", data: { email_id: randomUUID() } });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}`,
      },
      body: other,
    });
    return response.status;
  })();
  assert.equal(tampered, 401, `A body changed after signing should be refused, got ${tampered}`);
  pass("A body altered after signing is refused");

  console.log(`\n${passed.length} checks passed. The endpoint is ready for Resend.`);
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  console.error("\nIf everything returned 503, the server has not picked up");
  console.error("RESEND_WEBHOOK_SECRET yet — restart it and try again.");
  process.exitCode = 1;
}
