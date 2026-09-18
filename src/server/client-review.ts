"use server";

import { randomBytes, createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { authorize, PERMISSIONS } from "@/lib/authz";
import { supabaseServer, supabaseAnon } from "@/lib/supabase";
import {
  TOKEN_BYTES, issueLinkSchema, clientDecisionSchema,
  type ClientReviewContext,
} from "@/lib/client-review";
import type { ActionResult } from "./partners";

/** SHA-256, hex. The only form of a token that ever reaches the database. */
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a review link for a content version.
 *
 * The token is returned to the caller exactly once, for the staff member to
 * send on. It is not stored, not logged, and cannot be recovered afterwards -
 * if it is lost, withdraw the link and issue another.
 */
export async function issueReviewLink(
  input: unknown,
): Promise<ActionResult<{ token: string; expiresAt: string }>> {
  const _auth = await authorize(PERMISSIONS.PROJECT_MANAGE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = issueLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the reviewer details." };
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + parsed.data.expiryDays * 86_400_000).toISOString();

  const db = await supabaseServer();
  const { error } = await db.rpc("issue_client_review_link", {
    p_id: randomUUID(),
    p_version: parsed.data.versionId,
    p_token_hash: hashToken(token),
    p_name: parsed.data.recipientName,
    p_email: parsed.data.recipientEmail,
    p_expires: expiresAt,
  });

  if (error) {
    return {
      ok: false,
      error: error.code === "42501"
        ? "You do not have review authority on this project."
        : error.code === "23505"
          ? "This version already has a client decision."
          : error.code === "40001"
            ? "The work has moved on. Send the latest version of the current plan."
            : "This version is not ready for client review. It needs internal approval first.",
    };
  }

  revalidatePath("/projects");
  return { ok: true, data: { token, expiresAt } };
}

export async function revokeReviewLink(id: string): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.PROJECT_MANAGE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const db = await supabaseServer();
  const { error } = await db.rpc("revoke_client_review_link", { p_id: id });
  if (error) {
    return {
      ok: false,
      error: error.code === "42501"
        ? "You do not have review authority on this project."
        : "That link has already been used, or no longer exists.",
    };
  }
  revalidatePath("/projects");
  return { ok: true, data: undefined };
}

/**
 * What the holder of a link may see. Called without a session: the token is the
 * only credential, so this runs through the anonymous client and the database
 * function decides what comes back. An unknown token returns null, and says
 * nothing about why.
 */
export async function getClientReviewContext(token: string): Promise<ClientReviewContext | null> {
  const db = supabaseAnon();
  const { data, error } = await db.rpc("client_review_context", { p_token_hash: hashToken(token) });
  if (error || !data) return null;
  return data as ClientReviewContext;
}

/** The client's own decision, recorded by the client. */
export async function submitClientDecision(
  input: unknown,
): Promise<ActionResult<{ decision: string }>> {
  const parsed = clientDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your answer." };
  }

  const db = supabaseAnon();
  const { data, error } = await db.rpc("submit_client_review", {
    p_token_hash: hashToken(parsed.data.token),
    p_decision: parsed.data.decision,
    p_approver: parsed.data.approver,
    p_comments: parsed.data.comments,
  });

  if (error) {
    // The database's messages here are written for the client to read.
    const message = error.message ?? "";
    return {
      ok: false,
      error: error.code === "42501"
        ? (message.includes("withdrawn") || message.includes("expired") ? message : "This review link is not valid.")
        : error.code === "23505"
          ? "A decision has already been recorded for this link."
          : error.code === "40001"
            ? "This work has changed since the link was sent. Please ask for a new link."
            : message || "Your decision could not be recorded. Please try again.",
    };
  }

  revalidatePath(`/review/${parsed.data.token}`);
  return { ok: true, data: { decision: (data as { decision: string }).decision } };
}
