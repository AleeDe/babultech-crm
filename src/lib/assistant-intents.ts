/**
 * What a portal assistant message is asking for. Plain keyword matching, on
 * purpose: answers are predictable, nothing leaves our system, and anything it
 * does not recognise goes to the help articles and then to a person.
 */

export type CustomerIntent =
  | { kind: "raise_case"; problem: string | null }
  | { kind: "case_status"; caseNumber: string | null }
  | { kind: "open_cases" }
  | { kind: "replies" }
  | { kind: "projects" }
  | { kind: "milestone" }
  | { kind: "deliverable" }
  | { kind: "greeting" }
  | { kind: "search"; query: string };

export type PartnerIntent =
  | { kind: "register_deal" }
  | { kind: "deal_status"; reference: string | null }
  | { kind: "my_deals" }
  | { kind: "commission_pending" }
  | { kind: "commission_terms" }
  | { kind: "support" }
  | { kind: "greeting" }
  | { kind: "unknown"; query: string };

const CASE_NUMBER = /\bCASE-\d{4}-\d+|\bCASE-\d+/i;
const DEAL_NUMBER = /\bOPP-\d{4}-\d+|\bOPP-\d+/i;

const has = (text: string, ...patterns: RegExp[]) => patterns.some((p) => p.test(text));

/** A problem described rather than a request to start one: "my app is not loading". */
const PROBLEM = /\b(not|isn'?t|doesn'?t|won'?t|can'?t|cannot|unable)\b.{0,30}\b(work|load|open|start|connect|log ?in|sign ?in|send|save|show)|\b(error|broken|crash|down|fail(s|ed|ing)?|bug|stuck|slow)\b/i;

export function customerIntent(raw: string): CustomerIntent {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const caseNumber = text.match(CASE_NUMBER)?.[0]?.toUpperCase() ?? null;

  if (caseNumber) return { kind: "case_status", caseNumber };
  if (/^(hi|hello|hey|salam|assalam|good (morning|afternoon|evening))\b/.test(lower) && lower.length < 30) return { kind: "greeting" };
  if (has(lower, /\b(create|raise|open|log|new|start|submit|report)\b.{0,20}\b(case|ticket|issue|problem|complaint)\b/)) {
    return { kind: "raise_case", problem: PROBLEM.test(text) ? text : null };
  }
  if (has(lower, /\b(repl(y|ied|ies)|respon(se|ded)|answer(ed)?|got back)\b/)) return { kind: "replies" };
  if (has(lower, /\bstatus\b.{0,30}\b(ticket|case)\b|\b(ticket|case)\b.{0,30}\bstatus\b/)) return { kind: "case_status", caseNumber: null };
  if (has(lower, /\b(my|open|all|show|list)\b.{0,20}\b(cases|tickets)\b/)) return { kind: "open_cases" };
  if (has(lower, /\bmilestone/)) return { kind: "milestone" };
  if (has(lower, /\bdeliverable/)) return { kind: "deliverable" };
  if (has(lower, /\bprojects?\b/)) return { kind: "projects" };
  if (PROBLEM.test(text)) return { kind: "raise_case", problem: text };
  return { kind: "search", query: text };
}

export function partnerIntent(raw: string): PartnerIntent {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const dealNumber = text.match(DEAL_NUMBER)?.[0]?.toUpperCase() ?? null;

  if (dealNumber) return { kind: "deal_status", reference: dealNumber };
  if (/^(hi|hello|hey|salam|assalam|good (morning|afternoon|evening))\b/.test(lower) && lower.length < 30) return { kind: "greeting" };
  if (has(lower, /\b(register|registration|create|new|add|submit)\b.{0,25}\b(deal|opportunity)\b/, /\bdeal registration\b/)) return { kind: "register_deal" };
  if (has(lower, /\bcommission\b.{0,30}\b(agreement|work|rate|terms|percent|calculated|how)\b|\bhow\b.{0,30}\bcommission\b/)) return { kind: "commission_terms" };
  if (has(lower, /\b(commission|paid|payout|owed|pending|earn)/)) return { kind: "commission_pending" };
  if (has(lower, /\bstatus\b.{0,30}\b(deal|opportunity)\b|\b(deal|opportunity)\b.{0,30}\bstatus\b/)) {
    const quoted = text.match(/["“](.+?)["”]/)?.[1] ?? null;
    return { kind: "deal_status", reference: quoted };
  }
  if (has(lower, /\b(deals|opportunities|pipeline)\b/)) return { kind: "my_deals" };
  if (has(lower, /\b(support|case|cases|ticket|tickets|help|problem|issue)\b/)) return { kind: "support" };
  return { kind: "unknown", query: text };
}

/** The words worth searching help articles for: no filler, no punctuation. */
export function searchTerms(text: string): string {
  const stop = new Set(["how", "do", "i", "can", "the", "a", "an", "to", "my", "is", "what", "where", "find", "this", "you", "your", "me", "please", "for", "of", "in", "on", "it", "does", "with", "and", "or", "are", "we", "our", "about", "tell", "there", "any"]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
    .slice(0, 5)
    .join(" ");
}
