/**
 * The duplicate rule, as the app sees it.
 *
 * The rule itself lives in the database (20260928000001_duplicate_rule.sql):
 * a new lead whose email address, phone number or WhatsApp number is already on
 * a lead or a contact is refused, and so is a new contact whose details are
 * already on a contact. This module is the app's half - the same keys, for
 * checking a file against itself before it is sent, and the reading of the
 * database's refusal into something a form can point at.
 */

export type DuplicateField = "email" | "phone" | "whatsapp" | "mobile";

export const DUPLICATE_FIELD_LABEL: Record<DuplicateField, string> = {
  email: "email address",
  phone: "phone number",
  whatsapp: "WhatsApp number",
  mobile: "mobile number",
};

/** The existing record a new one collided with, cut down to what the asker may see. */
export interface DuplicateMatch {
  /** True when the asker is a partner and the record is not theirs: only `field` is filled. */
  hidden: boolean;
  /** Which of the NEW record's details matched. */
  field: DuplicateField;
  entity?: "lead" | "contact";
  id?: string;
  /** The lead number; contacts have none. */
  number?: string | null;
  name?: string;
  company?: string | null;
  accountId?: string | null;
  /** A partner's own record. */
  mine?: boolean;
  /** Position in the list that was checked, from find_duplicate_people. */
  row?: number;
}

/** Where a form can send somebody to see the record that already exists. */
export interface DuplicateRef {
  href: string;
  label: string;
}

/** An email address as the rule compares it: trimmed and lower-cased. Mirrors email_key(). */
export function emailKey(email: string | null | undefined): string | null {
  const key = (email ?? "").trim().toLowerCase();
  return key || null;
}

/**
 * A phone number as the rule compares it: the last nine digits, so a country
 * code or a trunk zero does not hide a match. Null when there are fewer, which
 * is too short to refuse anybody over. Mirrors phone_key().
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/**
 * The match behind a refusal, or null when the error is something else.
 *
 * Accepts a PostgREST error or anything thrown by createRecord/updateRecord,
 * which carry the same fields. The database marks the refusal with the hint
 * 'duplicate_person' and puts the match in the detail.
 */
export function duplicateFromError(error: unknown): DuplicateMatch | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { hint?: unknown; details?: unknown };
  if (e.hint !== "duplicate_person" || typeof e.details !== "string") return null;
  try {
    const parsed = JSON.parse(e.details) as DuplicateMatch;
    return parsed && typeof parsed.field === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** A link to the existing record, when the asker may see which one it is. */
export function duplicateRef(match: DuplicateMatch): DuplicateRef | undefined {
  if (match.hidden || !match.id || !match.entity) return undefined;
  if (match.entity === "lead") {
    return {
      href: `/leads/${match.id}`,
      label: match.number ? `${match.number} · ${match.name ?? "the lead"}` : (match.name ?? "the lead"),
    };
  }
  return {
    href: `/contacts/${match.id}`,
    label: match.company ? `${match.name ?? "the contact"} at ${match.company}` : (match.name ?? "the contact"),
  };
}

/** One line saying who a row collided with, for lists of skipped rows. */
export function describeDuplicate(match: DuplicateMatch): string {
  const field = DUPLICATE_FIELD_LABEL[match.field] ?? "details";
  if (match.hidden) return `Someone with this ${field} is already in our records`;
  const who = match.name ?? "Someone";
  const where = match.company ? ` at ${match.company}` : "";
  if (match.entity === "lead") {
    return `Already a lead: ${who}${match.number ? ` (${match.number})` : ""}${where}, same ${field}`;
  }
  return `Already a contact: ${who}${where}, same ${field}`;
}

/**
 * The failure a create or update action returns for a refusal: the database's
 * own sentence, the matching field highlighted, and a link when there is one.
 * Null when the error was not a duplicate, so the caller can fall through.
 */
export function duplicateFailure(
  error: unknown,
): { ok: false; error: string; fieldErrors: Record<string, string[]>; duplicate?: DuplicateRef } | null {
  const match = duplicateFromError(error);
  if (!match) return null;
  const message = error instanceof Error
    ? error.message
    : String((error as { message?: unknown }).message ?? "This person is already in our records.");
  return {
    ok: false,
    error: message,
    fieldErrors: { [match.field]: ["Already on file"] },
    duplicate: duplicateRef(match),
  };
}
