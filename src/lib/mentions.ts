/**
 * Parsing and rendering @mentions in a note.
 *
 * A mention is stored inside the note's own text as a token rather than as
 * markup: `@[Hassan Shamsi](user:37f25e81-…)`. Two reasons.
 *
 * First, the note content is plain text everywhere else in the system — the
 * list preview, the search, the notification email — and switching it to HTML
 * to carry a link would mean every one of those places had to learn to strip
 * tags, or would start showing markup to the reader.
 *
 * Second, and more importantly, a token cannot be crafted into an attack. The
 * text between the brackets is escaped on render and the id is validated as a
 * uuid, so the worst a person can type is a mention of somebody who does not
 * exist — which resolves to plain text, not a link.
 *
 * Who may be mentioned is decided on the server against the real user list,
 * never from the token. Someone editing the raw text to name a user id they
 * invented gets nothing: `extractMentions` returns the id, and the caller
 * checks it against app_user before a row is written or an email is sent.
 */

/** `@[Display Name](user:uuid)`. */
const MENTION_RE =
  /@\[([^\]]{1,120})\]\(user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

export interface ParsedMention {
  id: string;
  name: string;
}

/**
 * Every distinct user id named in the text.
 *
 * Deduplicated: writing "@Hassan" twice in one note is one mention and must not
 * produce two rows or two emails.
 */
export function extractMentions(content: string | null | undefined): ParsedMention[] {
  if (!content) return [];

  const seen = new Map<string, string>();
  for (const match of content.matchAll(MENTION_RE)) {
    const name = match[1];
    const id = match[2].toLowerCase();
    if (!seen.has(id)) seen.set(id, name);
  }

  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

/**
 * The note as a person reads it, with the tokens replaced by the plain names.
 *
 * For anywhere that cannot render markup: the list preview, a notification
 * email, an export. Without it a reader would see the raw token.
 */
export function mentionsToPlain(content: string | null | undefined): string {
  if (!content) return "";
  return content.replace(MENTION_RE, (_, name: string) => `@${name}`);
}

export type NoteSegment =
  | { kind: "text"; value: string }
  | { kind: "mention"; id: string; name: string };

/**
 * Split note text into plain runs and mentions, for rendering.
 *
 * Returning segments rather than an HTML string is deliberate: the component
 * renders each mention as a real `<Link>` and each text run as a text node, so
 * nothing in a note is ever passed through `dangerouslySetInnerHTML`. A note
 * remains plain text that happens to contain links.
 */
export function parseNoteSegments(content: string | null | undefined): NoteSegment[] {
  if (!content) return [];

  const out: NoteSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(MENTION_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      out.push({ kind: "text", value: content.slice(lastIndex, start) });
    }
    out.push({ kind: "mention", id: match[2].toLowerCase(), name: match[1] });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < content.length) {
    out.push({ kind: "text", value: content.slice(lastIndex) });
  }

  return out;
}

/** Build the token the editor inserts when someone is picked from the list. */
export function buildMentionToken(id: string, name: string): string {
  // The display name is stored alongside the id so an old note still reads
  // correctly after someone is renamed or deactivated — the link may go
  // nowhere useful, but the sentence still says who was meant.
  //
  // Brackets and parentheses are stripped rather than escaped: they would
  // terminate the token early, and no real name needs them.
  const safeName = name.replace(/[[\]()]/g, "").slice(0, 120).trim();
  return `@[${safeName}](user:${id})`;
}
