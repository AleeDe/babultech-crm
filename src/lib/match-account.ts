/**
 * Spotting that a lead's company is already an account.
 *
 * Converting a lead defaults to creating a new account, and the existing-account
 * picker offers no help finding one — so the same customer arrives twice under
 * slightly different spellings, and from then on their deals, invoices and
 * cases are split across two records that are painful to merge.
 *
 * The sample data has the case built in: two contacts at "Sultana Medical, Inc".
 * Convert both without noticing and the hospital exists twice.
 *
 * Matching is deliberately conservative. A false positive here is worse than a
 * miss: it invites someone to attach a lead to the wrong company, which is a
 * quieter and more damaging mistake than creating a duplicate they can see. So
 * this suggests rather than decides, and the person still chooses.
 */

/**
 * Company suffixes that carry no identity.
 *
 * "Sultana Medical" and "Sultana Medical, Inc" are the same organisation, and
 * the legal form is the part most likely to differ between a business card, a
 * signed contract and someone's memory.
 */
const SUFFIXES = [
  "inc", "incorporated", "llc", "ltd", "limited", "plc", "corp", "corporation",
  "co", "company", "gmbh", "sa", "sas", "bv", "nv", "ag", "pty", "pvt",
  "private", "pte", "llp", "lp", "group", "holdings", "holding",
  "international", "intl", "enterprises", "enterprise",
];

/**
 * Reduces a company name to the part that carries identity.
 *
 * Punctuation, case, legal suffixes and the word "the" all go. What remains is
 * compared literally — two names that normalise to the same string are treated
 * as the same company.
 */
export function normaliseCompany(name: string): string {
  const words = name
    .toLowerCase()
    // Ampersand before punctuation stripping, so "Smith & Sons" and
    // "Smith and Sons" converge rather than becoming "smithsons" vs "smithandsons".
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w !== "the" && w !== "and");

  // Suffixes are only dropped from the end. "Group Therapy Ltd" must keep its
  // "group" — the word only lacks meaning where a legal form would sit.
  while (words.length > 1 && SUFFIXES.includes(words[words.length - 1])) {
    words.pop();
  }

  return words.join(" ");
}

export interface AccountLike {
  id: string;
  name: string;
}

export interface AccountMatch {
  account: AccountLike;
  /** "exact" once normalised, or "close" for a containment match. */
  confidence: "exact" | "close";
}

/**
 * Finds accounts that look like the same company as `companyName`.
 *
 * Two rules, both requiring the shorter name to be at least four characters —
 * below that, containment is coincidence rather than evidence ("ABC" matching
 * "ABC Foods" is plausible, "AB" matching anything is not).
 *
 *   exact — the normalised names are identical
 *   close — one normalised name contains the other as a whole word run
 *
 * Whole-word containment rather than substring: "Medi" should not match
 * "Sultana Medical", but "Sultana Medical" should match "Sultana Medical Centre".
 */
export function findAccountMatches(
  companyName: string | null | undefined,
  accounts: AccountLike[],
): AccountMatch[] {
  if (!companyName) return [];

  const target = normaliseCompany(companyName);
  if (target.length < 4) return [];

  const matches: AccountMatch[] = [];

  for (const account of accounts) {
    const candidate = normaliseCompany(account.name);
    if (candidate.length < 4) continue;

    if (candidate === target) {
      matches.push({ account, confidence: "exact" });
      continue;
    }

    const [shorter, longer] =
      target.length <= candidate.length ? [target, candidate] : [candidate, target];

    // Word-boundary containment, so "medical" does not match "medicals" and a
    // fragment cannot match a longer word it happens to start.
    if (new RegExp(`(^|\\s)${escapeRegExp(shorter)}(\\s|$)`).test(longer)) {
      matches.push({ account, confidence: "close" });
    }
  }

  // Exact first, so the most likely candidate is the one read first.
  return matches.sort((a, b) =>
    a.confidence === b.confidence ? 0 : a.confidence === "exact" ? -1 : 1,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
