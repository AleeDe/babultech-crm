/**
 * What each screen is for, and where it sits in the chain.
 *
 * Every page already carries a one-line description, and there is a 536-line
 * guide at /guide. Neither answers the question people actually ask on arriving
 * at a screen they have not used: *what feeds this, and what does it turn into?*
 * Two of eighty pages mentioned a connection to anything else.
 *
 * That matters here more than in most systems, because almost nothing in this
 * app stands alone — a quote exists because a deal does, a contract because a
 * quote was accepted, commission because a partner was attached to a lead months
 * earlier. Someone who cannot see the chain will create records in the wrong
 * order and then wonder why a dropdown is empty, which is most of the questions
 * asked so far.
 *
 * Kept in one file rather than inline on each page so the chain can be read and
 * corrected as a whole. A wrong `feeds` here is a lie about how the system
 * works, and lies are easier to spot side by side than scattered across eighty
 * files.
 */

export interface PageGuide {
  /** What the screen is for, in one sentence. */
  purpose: string;
  /** What has to exist before this screen is useful. */
  needs?: string[];
  /** What this screen produces or leads to. */
  feeds?: string[];
  /** The thing people get wrong here, where there is one. */
  watchOut?: string;
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  "/": {
    purpose:
      "The state of the business in one screen - pipeline, cash, delivery load and anything that needs a decision today.",
    needs: ["Records created anywhere else in the app"],
    feeds: ["Nothing - this is a read-only summary"],
    watchOut:
      "Figures are scoped to what your role may see, so two people can correctly see different totals.",
  },

  "/leads": {
    purpose:
      "Unqualified prospects - yours, your team's, and every partner's. Nobody has agreed to anything yet, and no account or deal exists.",
    needs: ["Campaigns, if you want to attribute where a lead came from"],
    feeds: [
      "Converting a lead creates an Account, a Contact and an Opportunity - or, when the person is already a contact, uses that contact and their account",
      "A referring partner carries through to commission on the resulting deal",
      "A partner's leads are every salesperson's to work, whoever owns them - filter by Partner to see one partner's",
    ],
    watchOut:
      "A lead whose email, phone or WhatsApp number is already on a lead or a contact is refused, and you are shown which one. Numbers match on their last nine digits, so +92 300 and 0300 are the same. An import skips those people and lists them.",
  },

  "/campaigns": {
    purpose:
      "Marketing pushes you want to attribute leads and revenue to.",
    feeds: ["Leads reference a campaign, which is what links spend to what it returned"],
  },

  "/accounts": {
    purpose:
      "Organisations you deal with - customers, prospects, partners and vendors, one record with many roles. Every partner's customers are listed, with who brought them.",
    needs: ["Usually created by converting a lead"],
    feeds: ["Opportunities, contracts, projects, invoices and support cases all hang off an account"],
    watchOut:
      "Check whether a company already exists before converting a lead - duplicate accounts split a customer's history and are painful to merge.",
  },

  "/contacts": {
    purpose: "The people at those organisations.",
    needs: ["An account to belong to"],
    feeds: ["Quotations and cases are addressed to a contact"],
    watchOut:
      "A contact whose email, phone, mobile or WhatsApp number is already on another contact is refused, and you are shown which one. One mobile number in any of those boxes counts as the same number.",
  },

  "/opportunities": {
    purpose: "Deals you are working - what might close, for how much, and when. Every partner's deals are here too, whoever owns them.",
    needs: ["An account, usually from converting a lead"],
    feeds: [
      "Quotations are raised against a deal",
      "A partner's deal carries their commission record, and winning one can start a project",
    ],
    watchOut:
      "A deal cannot be marked Closed Won without an amount, at least one product or service, and an accepted quote. Winning it starts its delivery project. Partners close their own deals from the portal by the same rule.",
  },

  "/quotations": {
    purpose: "Versioned, priced offers sent to a customer against one deal.",
    needs: ["A deal to quote against - its products and services become the quote's lines, every value editable"],
    feeds: [
      "Accepting a quote puts its lines on the deal in place of what was there, so the deal's value - and any partner commission - becomes the quote's, and moves the deal to Verbal Confirmation",
      "Contracts are usually built from an accepted quote",
    ],
    watchOut:
      "Once sent, a quote is locked. Change it by revising, which supersedes it with a new version. A quote a partner prepares in the portal cannot be sent until somebody who approves quotations approves it.",
  },

  "/contracts": {
    purpose: "The agreed terms - value, dates, billing frequency and renewal.",
    needs: ["Usually an accepted quotation"],
    feeds: ["Projects deliver against a contract", "Invoices reference it"],
    watchOut:
      "The quote picker is filtered by the customer, so choose the customer first or it will look empty.",
  },

  "/products": {
    purpose:
      "Everything we and our partners sell - BabulTech's products and services, and partners' own. Prices live in price books.",
    feeds: [
      "Deal and quote lines are picked from here and priced from the deal's price book",
      "A service marked Add in Task is sold in hours, and those hours become a project task when the deal is won",
      "Partners see our items read-only in the portal, and keep their own company's items there",
    ],
    watchOut:
      "An item's type is locked once it is priced in a book or sold on a deal: create a new one instead.",
  },

  "/partners": {
    purpose: "Resellers and referrers who bring you business, and work it themselves in the partner portal.",
    feeds: [
      "Each deal credited to a partner gets a commission record at the partner's rate",
      "Partners work their own leads, customers, deals, quotes and items in the portal; every salesperson can see and work them too",
    ],
    watchOut:
      "Only an Active partner gets commission records. Changing a partner's rate applies to their new deals, not ones already running.",
  },

  "/commissions": {
    purpose: "One record per partner deal - what the partner is owed on it, and whether it has been paid.",
    needs: ["A deal credited to an Active partner"],
    feeds: ["The partner sees the same record in the portal"],
    watchOut:
      "The payment date is set when the deal is won, 90 days on. Paid and Rejected are final.",
  },

  "/projects": {
    purpose:
      "Delivery engagements - work you do for a customer, and our own internal projects.",
    needs: ["For customer work, an account and usually a contract"],
    feeds: [
      "Milestones become invoices",
      "Logged time becomes billable hours and project cost",
    ],
    watchOut:
      "Only people on the project team can book time to it. Internal projects are never invoiced, and their costs cannot be recharged.",
  },

  "/vault": {
    purpose:
      "The keys, passwords and service logins the business runs on - one place that says who owns each and when it lapses.",
    needs: ["SECRET_VAULT_KEY set in the environment"],
    feeds: [
      "Nothing automatically - this is a register people read",
      "Every reveal is recorded against the person who did it",
    ],
    watchOut:
      "Values are encrypted with a key held outside the database. Lose SECRET_VAULT_KEY and no stored value can be recovered.",
  },

  "/timesheets": {
    purpose: "Your week - what you worked on, for how long, and when.",
    needs: ["A project you are a member of, or a support case"],
    feeds: [
      "Approved billable time can be invoiced",
      "Project cost, margin and utilisation all read these hours",
    ],
    watchOut:
      "Time has to be approved before it can be invoiced. Unapproved hours are revenue sitting still.",
  },

  "/resources": {
    purpose:
      "Who is booked on what, and how much of their capacity is used.",
    needs: ["Project teams and logged time"],
    watchOut: "Shows cost rates, so it is limited to people who approve time.",
  },

  "/cases": {
    purpose: "Customer problems, tracked against an SLA.",
    needs: ["An account, and usually a contact"],
    feeds: ["Time logged against a case feeds support cost"],
  },

  "/activities": {
    purpose: "Calls, meetings and tasks - the touches that move a deal along.",
    feeds: ["Attached to a lead, deal, account or case as its history - including the calls and meetings partners log in the portal"],
  },

  "/invoices": {
    purpose: "What you have billed, and what is still outstanding.",
    needs: ["Something to bill - a milestone, approved time, or a contract"],
    feeds: ["Payments are allocated against invoices"],
    watchOut:
      "A draft invoice can be edited; once issued it cannot. Reverse it with a credit note instead.",
  },

  "/payments": {
    purpose: "Money received, and which invoices it settles.",
    needs: ["An issued invoice"],
    feeds: ["Allocation clears an invoice's outstanding amount"],
    watchOut:
      "A payment and its allocation are separate: one payment often settles several invoices.",
  },

  "/vendor-bills": {
    purpose: "What your suppliers have billed you.",
    feeds: ["Vendor payments, and project cost where a bill is attributed to one"],
  },

  "/expenses": {
    purpose: "Money your people spent that needs reimbursing or attributing.",
    needs: ["An expense category, and a project if the cost is billable"],
    feeds: ["Approved expenses become project cost, and billable ones can be invoiced on"],
    watchOut: "Nobody can approve their own claim, whatever their role.",
  },

  "/approvals": {
    purpose:
      "Everything waiting on you - quotes partners prepared, expenses, time, bills and commission, in one queue.",
    needs: ["An approval permission for the kind of record"],
    feeds: ["Approving here unblocks invoicing and payment elsewhere"],
  },

  "/my-work": {
    purpose: "Your tasks, activities and follow-ups across every module.",
  },

  "/users": {
    purpose: "Who can sign in, and what their role lets them see and do.",
    feeds: [
      "Role decides both permissions and how much data a person sees",
      "A Partner-role user is linked to a partner record and sees only the portal",
    ],
    watchOut:
      "Data scope matters as much as permissions: OWN, TEAM, DEPARTMENT or ALL decides whose records appear.",
  },

  "/settings": {
    purpose:
      "The lists the rest of the app chooses from - categories, tax rates, currencies, numbering and SLA policies.",
    feeds: ["Almost every dropdown in the system reads from here"],
  },
};

/**
 * The guide for a path, matched longest-prefix first.
 *
 * A detail page inherits its list's guide — /leads/abc123 is still the leads
 * screen as far as "how does this fit together" goes, and writing a separate
 * entry for every record would be both impossible and pointless.
 */
export function guideFor(pathname: string): PageGuide | null {
  if (PAGE_GUIDES[pathname]) return PAGE_GUIDES[pathname];

  const match = Object.keys(PAGE_GUIDES)
    .filter((key) => key !== "/" && pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];

  return match ? PAGE_GUIDES[match] : null;
}
