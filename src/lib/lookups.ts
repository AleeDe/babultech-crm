/**
 * Reference fields: one record pointing at another.
 *
 * A contact's company, a deal's account, an expense's project. These used to be
 * <select> elements holding every record in the table, which stops working at a
 * few hundred rows - the browser renders them all, and nobody scrolls a list of
 * eight hundred accounts to find one. A lookup searches on the server instead
 * and shows a handful of matches.
 *
 * This file is the shared vocabulary; the search itself is in
 * src/server/lookups.ts and the field in src/components/record-lookup.tsx.
 */

export type LookupEntity =
  | "account"
  | "contact"
  | "user"
  | "partner"
  | "campaign"
  | "lead"
  | "opportunity"
  | "quotation"
  | "contract"
  | "product"
  | "project"
  | "invoice"
  | "case";

/** One match, as the field shows it. */
export interface LookupRecord {
  id: string;
  /** What the field displays once chosen, e.g. "Sapphire Textiles". */
  label: string;
  /** Context under the label: a number, an owner, a status. */
  sublabel?: string | null;
}

export interface LookupFilters {
  /** Narrows to one parent, e.g. a contact's account or a project's account. */
  accountId?: string | null;
  /** Deals, quotes and projects for one opportunity. */
  opportunityId?: string | null;
  /** Internal users only, excluding partner and customer logins. */
  internalOnly?: boolean;
  /** Include records that are inactive, retired or closed. Off by default. */
  includeInactive?: boolean;
}

/** How each entity is described in the field before anything is typed. */
export const LOOKUP_PLACEHOLDER: Record<LookupEntity, string> = {
  account: "Search accounts…",
  contact: "Search contacts…",
  user: "Search people…",
  partner: "Search partners…",
  campaign: "Search campaigns…",
  lead: "Search leads…",
  opportunity: "Search deals…",
  quotation: "Search quotations…",
  contract: "Search contracts…",
  product: "Search products…",
  project: "Search projects…",
  invoice: "Search invoices…",
  case: "Search cases…",
};

/** The page a chosen record can be opened on, for the field's link. */
export const LOOKUP_HREF: Record<LookupEntity, ((id: string) => string) | null> = {
  account: (id) => `/accounts/${id}`,
  contact: (id) => `/contacts/${id}`,
  user: (id) => `/users/${id}`,
  partner: (id) => `/partners/${id}`,
  campaign: (id) => `/campaigns/${id}`,
  lead: (id) => `/leads/${id}`,
  opportunity: (id) => `/opportunities/${id}`,
  quotation: (id) => `/quotations/${id}`,
  contract: (id) => `/contracts/${id}`,
  product: (id) => `/products/${id}`,
  project: (id) => `/projects/${id}`,
  invoice: (id) => `/invoices/${id}`,
  case: (id) => `/cases/${id}`,
};

export const LOOKUP_PAGE_SIZE = 20;
