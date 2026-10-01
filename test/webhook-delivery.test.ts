import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: vi.fn() }));
import { signWebhook, isPrivateAddress } from "@/lib/webhook-delivery";

describe("webhook signatures", () => {
  it("signs the timestamp and body with the secret, as receivers check it", () => {
    const body = JSON.stringify({ event: "lead.created" });
    const expected = createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex");
    expect(signWebhook("whsec_test", "1700000000", body)).toBe(`sha256=${expected}`);
  });

  it("changes when the body changes", () => {
    expect(signWebhook("s", "1", "a")).not.toBe(signWebhook("s", "1", "b"));
  });
});

describe("addresses webhooks may call", () => {
  afterEach(() => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
  });

  it("allows public addresses", () => {
    expect(isPrivateAddress("https://hooks.example.com/crm")).toBe(false);
    expect(isPrivateAddress("https://172.32.0.1/x")).toBe(false);
  });

  it("refuses the server's own neighbours", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest", "http://172.16.0.1/", "http://[::1]/", "not a url"]) {
      expect(isPrivateAddress(url), url).toBe(true);
    }
  });

  it("allows them for local testing when switched on", () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = "1";
    expect(isPrivateAddress("http://localhost:3999/hook")).toBe(false);
  });
});
