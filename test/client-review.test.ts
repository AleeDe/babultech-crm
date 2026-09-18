import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  reviewLinkUrl, tokenPattern, issueLinkSchema, clientDecisionSchema,
  canDecide, MAX_EXPIRY_DAYS, type ClientReviewContext,
} from "@/lib/client-review";

const context = (overrides: Partial<ClientReviewContext> = {}): ClientReviewContext => ({
  linkId: "l1", recipientName: "Client", expiresAt: "2026-10-01T00:00:00Z",
  expired: false, revoked: false, usedAt: null, taskName: "Launch post",
  versionNumber: 1, channel: "INSTAGRAM", format: "POST", objective: "o",
  audience: "a", brief: "b", plannedFor: "2026-09-30T00:00:00Z",
  copy: "the copy", assetUrl: null, decision: null, ...overrides,
});

describe("review link urls", () => {
  it("builds a link without doubling the slash", () => {
    expect(reviewLinkUrl("https://crm.example.com", "abc")).toBe("https://crm.example.com/review/abc");
    expect(reviewLinkUrl("https://crm.example.com/", "abc")).toBe("https://crm.example.com/review/abc");
  });
});

describe("token shape", () => {
  it("accepts base64url tokens of the length we mint", () => {
    // 32 random bytes as base64url is 43 characters.
    expect(tokenPattern.test("a".repeat(43))).toBe(true);
    expect(tokenPattern.test("A-b_C9".padEnd(43, "x"))).toBe(true);
  });

  it("rejects anything short, empty or carrying path characters", () => {
    expect(tokenPattern.test("")).toBe(false);
    expect(tokenPattern.test("short")).toBe(false);
    expect(tokenPattern.test("../../etc/passwd")).toBe(false);
    expect(tokenPattern.test(`${"a".repeat(43)}/..`)).toBe(false);
  });
});

describe("issuing a link", () => {
  const valid = { versionId: "11111111-1111-4111-8111-111111111111", recipientName: "Client Person", recipientEmail: "client@example.com" };

  it("defaults the expiry rather than leaving a link open forever", () => {
    const parsed = issueLinkSchema.parse(valid);
    expect(parsed.expiryDays).toBe(14);
  });

  it("refuses an expiry beyond the cap", () => {
    expect(issueLinkSchema.safeParse({ ...valid, expiryDays: MAX_EXPIRY_DAYS + 1 }).success).toBe(false);
  });

  it("refuses a zero or negative expiry", () => {
    expect(issueLinkSchema.safeParse({ ...valid, expiryDays: 0 }).success).toBe(false);
    expect(issueLinkSchema.safeParse({ ...valid, expiryDays: -5 }).success).toBe(false);
  });

  it("requires a real email so the audit trail names someone", () => {
    expect(issueLinkSchema.safeParse({ ...valid, recipientEmail: "not-an-email" }).success).toBe(false);
  });

  it("requires a recipient name", () => {
    expect(issueLinkSchema.safeParse({ ...valid, recipientName: "   " }).success).toBe(false);
  });
});

describe("the client's decision", () => {
  const token = "a".repeat(43);
  const valid = { token, decision: "APPROVED", approver: "Client Person", comments: "Happy with this" };

  it("accepts a complete answer", () => {
    expect(clientDecisionSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a decision we did not offer", () => {
    expect(clientDecisionSchema.safeParse({ ...valid, decision: "MAYBE" }).success).toBe(false);
  });

  it("requires a name and a comment", () => {
    expect(clientDecisionSchema.safeParse({ ...valid, approver: "  " }).success).toBe(false);
    expect(clientDecisionSchema.safeParse({ ...valid, comments: "  " }).success).toBe(false);
  });

  it("refuses a malformed token before it reaches the database", () => {
    expect(clientDecisionSchema.safeParse({ ...valid, token: "../admin" }).success).toBe(false);
  });

  it("trims what the client typed", () => {
    const parsed = clientDecisionSchema.parse({ ...valid, approver: "  Client Person  ", comments: "  Fine.  " });
    expect(parsed.approver).toBe("Client Person");
    expect(parsed.comments).toBe("Fine.");
  });
});

describe("whether a link can still be used", () => {
  it("allows a fresh, undecided link", () => {
    expect(canDecide(context())).toBe(true);
  });

  it("refuses an expired link", () => {
    expect(canDecide(context({ expired: true }))).toBe(false);
  });

  it("refuses a withdrawn link", () => {
    expect(canDecide(context({ revoked: true }))).toBe(false);
  });

  it("refuses a link that already carries a decision", () => {
    expect(canDecide(context({
      decision: { decision: "APPROVED", evidence: "yes", approver: "Client", at: "2026-09-01T00:00:00Z" },
    }))).toBe(false);
  });
});

// ---------------------------------------------------------------- the actions

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), server: vi.fn(), anon: vi.fn(), rpc: vi.fn(), anonRpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  authorize: mocks.authorize,
  requirePermission: vi.fn(),
  can: vi.fn(() => true),
  PERMISSIONS: { PROJECT_MANAGE: "project:manage" },
}));
vi.mock("@/lib/supabase", () => ({ supabaseServer: mocks.server, supabaseAnon: mocks.anon }));

const { issueReviewLink, getClientReviewContext, submitClientDecision } = await import("@/server/client-review");

describe("issuing a link, as an action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: true, user: { id: "pm" } });
    mocks.rpc.mockResolvedValue({ data: "link-id", error: null });
    mocks.server.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("checks review authority before touching the database", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Not allowed." });
    const result = await issueReviewLink({ versionId: "11111111-1111-4111-8111-111111111111", recipientName: "C", recipientEmail: "c@example.com" });
    expect(result.ok).toBe(false);
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it("sends only a hash to the database, never the token", async () => {
    const result = await issueReviewLink({
      versionId: "11111111-1111-4111-8111-111111111111",
      recipientName: "Client", recipientEmail: "client@example.com",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const args = mocks.rpc.mock.calls[0][1];
    expect(args.p_token_hash).toBe(createHash("sha256").update(result.data.token).digest("hex"));
    expect(args.p_token_hash).toHaveLength(64);
    // The token itself must not appear anywhere in what was sent.
    expect(JSON.stringify(args)).not.toContain(result.data.token);
  });

  it("returns a token that matches the shape the route accepts", async () => {
    const result = await issueReviewLink({
      versionId: "11111111-1111-4111-8111-111111111111",
      recipientName: "Client", recipientEmail: "client@example.com",
    });
    if (result.ok) expect(tokenPattern.test(result.data.token)).toBe(true);
  });

  it("mints a different token every time", async () => {
    const input = { versionId: "11111111-1111-4111-8111-111111111111", recipientName: "Client", recipientEmail: "client@example.com" };
    const a = await issueReviewLink(input);
    const b = await issueReviewLink(input);
    if (a.ok && b.ok) expect(a.data.token).not.toBe(b.data.token);
  });

  it("explains a refusal without leaking the database's wording", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "22023", message: "internal constraint detail" } });
    const result = await issueReviewLink({
      versionId: "11111111-1111-4111-8111-111111111111",
      recipientName: "Client", recipientEmail: "client@example.com",
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("internal constraint detail");
  });
});

describe("reading and answering a link, as actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.anonRpc.mockResolvedValue({ data: null, error: null });
    mocks.anon.mockReturnValue({ rpc: mocks.anonRpc });
  });

  it("looks the link up by hash, not by the token in the url", async () => {
    await getClientReviewContext("a".repeat(43));
    expect(mocks.anonRpc).toHaveBeenCalledWith("client_review_context", {
      p_token_hash: createHash("sha256").update("a".repeat(43)).digest("hex"),
    });
  });

  it("returns nothing for an unknown link, without explaining why", async () => {
    mocks.anonRpc.mockResolvedValue({ data: null, error: null });
    expect(await getClientReviewContext("a".repeat(43))).toBeNull();
  });

  it("returns nothing when the lookup itself fails", async () => {
    mocks.anonRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await getClientReviewContext("a".repeat(43))).toBeNull();
  });

  it("validates the client's answer before sending it", async () => {
    const result = await submitClientDecision({ token: "a".repeat(43), decision: "MAYBE", approver: "C", comments: "x" });
    expect(result.ok).toBe(false);
    expect(mocks.anonRpc).not.toHaveBeenCalled();
  });

  it("hashes the token on submission too", async () => {
    mocks.anonRpc.mockResolvedValue({ data: { decision: "APPROVED" }, error: null });
    await submitClientDecision({ token: "a".repeat(43), decision: "APPROVED", approver: "Client", comments: "Fine" });
    const args = mocks.anonRpc.mock.calls[0][1];
    expect(args.p_token_hash).toHaveLength(64);
    expect(args.p_token_hash).not.toContain("a".repeat(43));
  });

  it("passes a used-link refusal back in words the client can act on", async () => {
    mocks.anonRpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });
    const result = await submitClientDecision({ token: "a".repeat(43), decision: "APPROVED", approver: "Client", comments: "Fine" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already been recorded");
  });

  it("tells the client plainly when the work has moved on", async () => {
    mocks.anonRpc.mockResolvedValue({ data: null, error: { code: "40001", message: "conflict" } });
    const result = await submitClientDecision({ token: "a".repeat(43), decision: "APPROVED", approver: "Client", comments: "Fine" });
    if (!result.ok) expect(result.error).toContain("ask for a new link");
  });
});
