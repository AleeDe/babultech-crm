/**
 * When a partner's quote may go to the customer - the rule the portal shows
 * and the server enforces before an email is attempted. The database enforces
 * it regardless (20260928000006): a quote a partner prepared reaches the
 * customer only once one of our managers has approved it.
 */

export interface QuoteSendState {
  quoteNumber: string;
  status: string;
  preparedByPartnerId: string | null;
  expiryDate: string;
}

/**
 * Why this quote cannot be emailed to the customer now, or null when it can.
 * The first send marks it sent; a sent quote may be emailed again.
 */
export function partnerQuoteEmailBlock(q: QuoteSendState): string | null {
  if (["DRAFT", "UNDER_REVIEW"].includes(q.status) && q.preparedByPartnerId) {
    return q.status === "UNDER_REVIEW"
      ? `${q.quoteNumber} is waiting for approval. It can be emailed once your partner manager approves it.`
      : `${q.quoteNumber} needs your partner manager's approval before it goes to the customer. Ask for approval first.`;
  }
  if (!["DRAFT", "APPROVED", "SENT"].includes(q.status)) {
    return `${q.quoteNumber} is ${q.status.toLowerCase().replace("_", " ")}, so it is not emailed from here.`;
  }
  // The day it expires is still a day it holds, as in the database.
  if (q.status !== "SENT" && q.expiryDate.slice(0, 10) < new Date().toISOString().slice(0, 10)) {
    return "This quote's valid-until date has passed. Change its dates before sending it.";
  }
  return null;
}
