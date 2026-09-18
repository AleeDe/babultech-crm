import { z } from "zod";

/**
 * A review link's token. 32 random bytes, base64url, so it is unguessable and
 * survives being pasted into an email or a chat message.
 *
 * The token is shown to the staff member once, sent to the client, and never
 * stored. Only its SHA-256 goes to the database, so a copy of the database
 * yields no working links.
 */
export const TOKEN_BYTES = 32;

export function reviewLinkUrl(origin: string, token: string) {
  return `${origin.replace(/\/+$/, "")}/review/${token}`;
}

/** Tokens are base64url, so this is what a well-formed one looks like. */
export const tokenPattern = /^[A-Za-z0-9_-]{32,64}$/;

export const DEFAULT_EXPIRY_DAYS = 14;
export const MAX_EXPIRY_DAYS = 60;

export const issueLinkSchema = z.object({
  versionId: z.string().uuid(),
  recipientName: z.string().trim().min(1, "Who is reviewing this?").max(200),
  recipientEmail: z.string().trim().email("Enter a valid email address.").max(320),
  expiryDays: z.coerce.number().int().min(1).max(MAX_EXPIRY_DAYS).default(DEFAULT_EXPIRY_DAYS),
});

export const clientDecisionSchema = z.object({
  token: z.string().regex(tokenPattern, "This review link is not valid."),
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED"], {
    message: "Choose whether this is approved or needs changes.",
  }),
  approver: z.string().trim().min(1, "Please give your name.").max(200),
  comments: z.string().trim().min(1, "Please say something about your decision.").max(4000),
});

export type ClientReviewContext = {
  linkId: string;
  recipientName: string;
  expiresAt: string;
  expired: boolean;
  revoked: boolean;
  usedAt: string | null;
  taskName: string;
  versionNumber: number;
  channel: string;
  format: string;
  objective: string;
  audience: string;
  brief: string;
  plannedFor: string;
  copy: string;
  assetUrl: string | null;
  decision: { decision: string; evidence: string; approver: string | null; at: string } | null;
};

/** Why a link cannot be acted on, or null if it can. */
export function linkBlocker(context: ClientReviewContext): string | null {
  if (context.revoked) return "This review link has been withdrawn. Please contact your account manager.";
  if (context.expired) return "This review link has expired. Please ask for a new one.";
  if (context.decision) return null;
  return null;
}

export function canDecide(context: ClientReviewContext) {
  return !context.revoked && !context.expired && !context.decision;
}
