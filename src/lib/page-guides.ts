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
      "Unqualified prospects. Nobody has agreed to anything yet, and no account or deal exists.",
    needs: ["Campaigns, if you want to attribute where a lead came from"],
    feeds: [
      "Converting a lead creates an Account, a Contact and an Opportunity",
      "A referring partner carries through to commission on the resulting deal",
    ],
    watchOut:
      "Importing leads creates no accounts. The company name is free text until you convert.",
  },

  "/campaigns": {
    purpose:
      "Marketing pushes you want to attribute leads and revenue to.",
    feeds: ["Leads reference a campaign, which is what links spend to what it returned"],
  },

  "/accounts": {
    purpose:
      "Organisations you deal with - customers, prospects, partners and vendors, one record with many roles.",
    needs: ["Usually created by converting a lead"],
    feeds: ["Opportunities, contracts, projects, invoices and support cases all hang off an account"],
    watchOut:
      "Check whether a company already exists before converting a lead - duplicate accounts split a customer's history and are painful to merge.",
  },

  "/contacts": {
    purpose: "The people at those organisations.",
    needs: ["An account to belong to"],
    feeds: ["Quotations and cases are addressed to a contact"],
  },

  "/opportunities": {
    purpose: "Deals you are working - what might close, for how much, and when.",
    needs: ["An account, usually from converting a lead"],
    feeds: [
      "Quotations are raised against a deal",
      "Winning one accrues partner commission and can start a project",
    ],
    watchOut:
      "A deal cannot be marked Closed Won without an accepted quote, an amount and a close date.",
  },

  "/quotations": {
    purpose: "Versioned, priced offers sent to a customer against one deal.",
    needs: ["An opportunity to quote against", "Products, so lines are not retyped"],
    feeds: [
      "An accepted quote moves the deal to Verbal Confirmation and sets its value",
      "Contracts are usually built from an accepted quote",
    ],
    watchOut:
      "Once sent, a quote is locked. Change it by revising, which supersedes it with a new version.",
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
      "Your catalogue - what you sell, at what standard price and cost.",
    feeds: [
      "Quotation and invoice lines pull price and tax from here",
      "Standard cost is what makes margin figures meaningful",
    ],
    watchOut:
      "Set standard cost even roughly. Without it every margin figure in the system reads zero.",
  },

  "/partners": {
    purpose: "Resellers and referrers who bring you business.",
    feeds: ["Attaching a partner to a deal is what earns them commission"],
    watchOut:
      "Commission only accrues for partners whose status is Active and who hold a commission plan.",
  },

  "/commissions": {
    purpose: "What partners have earned, and where each amount is in its approval.",
    needs: ["A partner attached to a won deal, with a commission plan"],
    feeds: ["Payouts, once approved"],
    watchOut:
      "When commission accrues depends on the plan's trigger - on close, on invoice, or on payment received.",
  },

  "/projects": {
    purpose: "Delivery engagements - the work you actually do for a customer.",
    needs: ["An account, and usually a contract"],
    feeds: [
      "Milestones become invoices",
      "Logged time becomes billable hours and project cost",
    ],
    watchOut:
      "Only people on the project team can book time to it.",
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
    feeds: ["Attached to a lead, deal, account or case as its history"],
  },

  "/invoices": {
    purpose: "What you have billed, and what is still outstanding.",
    needs: ["Something to bill - a milestone, approved time, or a contract"],
    feeds: ["Payments are allocated against invoices", "Commission may accrue on issue"],
    watchOut:
      "A draft invoice can be edited; once issued it cannot. Reverse it with a credit note instead.",
  },

  "/payments": {
    purpose: "Money received, and which invoices it settles.",
    needs: ["An issued invoice"],
    feeds: ["Allocation clears an invoice's outstanding amount", "May trigger partner commission"],
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
      "Everything waiting on you - quotes, expenses, time, bills and commission, in one queue.",
    needs: ["An approval permission for the kind of record"],
    feeds: ["Approving here unblocks invoicing, payment and payout elsewhere"],
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
