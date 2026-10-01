"use server";

import { requireUser } from "@/lib/authz";
import { customerIntent, partnerIntent, searchTerms } from "@/lib/assistant-intents";
import { listMyCases, getMyCase, listArticles, raiseTicketFromAssistant } from "./support-portal";
import { listCustomerProjects, getCustomerProject } from "./customer-projects";
import { getPortalDeals, getPortalSummary, getPartnerProfile } from "./portal";
import { postPartnerMessage } from "./partner-activities";
import { formatDate, formatMoneyPlain, formatPercent, humanize } from "@/lib/utils";
import type { ActionResult } from "./partners";

/**
 * The portal assistant. It answers with the same server functions the portal
 * pages use, under the person's own session, so it can never show more than
 * those pages would: no separate security logic, as the specification asks.
 */

export interface AssistantLink {
  href: string;
  label: string;
}

export interface AssistantReply {
  text: string;
  links?: AssistantLink[];
  /** Questions to offer as buttons next. */
  suggestions?: string[];
  /** Offer to raise a case (customers) or pass the conversation on (partners). */
  offerEscalation?: boolean;
  /** Start collecting a new case, with the problem already described. */
  startCase?: { problem: string | null };
}

const OPEN_CASE = (status: string) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(status);
const CUSTOMER_SUGGESTIONS = ["Show my open cases", "Has someone replied to my case?", "Show my active projects", "Create a case"];
const PARTNER_SUGGESTIONS = ["Show my opportunities", "What commission is pending?", "How does our commission agreement work?", "Create a deal registration"];

export async function askAssistant(message: string): Promise<AssistantReply> {
  const text = message.trim().slice(0, 1000);
  if (!text) return { text: "Ask me anything about your account." };
  const me = await requireUser();
  try {
    if (me.userType === "CUSTOMER") return await answerCustomer(text);
    if (me.userType === "PARTNER") return await answerPartner(text, me.portalRole === "ADMIN");
  } catch {
    return { text: "Something went wrong looking that up.", offerEscalation: true };
  }
  return { text: "The assistant is for the customer and partner portals." };
}

async function answerCustomer(text: string): Promise<AssistantReply> {
  const intent = customerIntent(text);
  switch (intent.kind) {
    case "greeting":
      return { text: "Hello! I can check your tickets and projects, find help articles, or raise a case for you.", suggestions: CUSTOMER_SUGGESTIONS };

    case "raise_case":
      return {
        text: intent.problem ? "I can raise a support case about that for you." : "I can raise a support case for you. What is the problem?",
        startCase: { problem: intent.problem },
      };

    case "case_status": {
      const cases = await listMyCases();
      const found = intent.caseNumber ? cases.find((c) => c.caseNumber.toUpperCase() === intent.caseNumber) : cases.find((c) => OPEN_CASE(c.status)) ?? cases[0];
      if (!found) {
        return intent.caseNumber
          ? { text: `I could not find ${intent.caseNumber} among your company's tickets.`, suggestions: ["Show my open cases"] }
          : { text: "You have no tickets yet.", suggestions: ["Create a case"] };
      }
      const detail = await getMyCase(found.id);
      const last = detail?.comments[detail.comments.length - 1];
      const lastLine = last ? ` The latest message is from ${last.fromUs ? last.author : "you"}, on ${formatDate(last.createdAt)}.` : " Nobody has replied yet.";
      return {
        text: `${found.caseNumber} "${found.subject}" is ${humanize(found.status).toLowerCase()}.${lastLine}`,
        links: [{ href: `/support/tickets/${found.id}`, label: `Open ${found.caseNumber}` }],
      };
    }

    case "open_cases": {
      const open = (await listMyCases()).filter((c) => OPEN_CASE(c.status));
      if (!open.length) return { text: "You have no open tickets.", suggestions: ["Create a case"] };
      return {
        text: `You have ${open.length} open ticket${open.length === 1 ? "" : "s"}${open.length > 5 ? " - here are the newest five" : ""}:`,
        links: open.slice(0, 5).map((c) => ({ href: `/support/tickets/${c.id}`, label: `${c.caseNumber} · ${c.subject} · ${humanize(c.status)}` })),
      };
    }

    case "replies": {
      const open = (await listMyCases()).filter((c) => OPEN_CASE(c.status)).slice(0, 5);
      const answered: AssistantLink[] = [];
      for (const c of open) {
        const detail = await getMyCase(c.id);
        const last = detail?.comments[detail.comments.length - 1];
        if (last?.fromUs) answered.push({ href: `/support/tickets/${c.id}`, label: `${c.caseNumber} · ${last.author} replied ${formatDate(last.createdAt)}` });
      }
      if (!open.length) return { text: "You have no open tickets to wait on." };
      return answered.length
        ? { text: "We have replied on these, and they are waiting for you:", links: answered }
        : { text: "Nobody has replied on your open tickets since your last message yet. You are notified by email when we do.", links: open.map((c) => ({ href: `/support/tickets/${c.id}`, label: `${c.caseNumber} · ${c.subject}` })) };
    }

    case "projects": {
      const projects = (await listCustomerProjects()).filter((p) => !["COMPLETED", "CANCELLED"].includes(p.status));
      if (!projects.length) return { text: "You have no active projects with us." };
      return {
        text: `Your active project${projects.length === 1 ? "" : "s"}:`,
        links: projects.map((p) => ({ href: `/support/projects/${p.id}`, label: `${p.name} · ${Math.round(p.completionPercent)}% done${p.plannedEndDate ? ` · due ${formatDate(p.plannedEndDate)}` : ""}` })),
        suggestions: ["What's the next milestone?", "Where can I find this deliverable?"],
      };
    }

    case "milestone": {
      const projects = (await listCustomerProjects()).filter((p) => !["COMPLETED", "CANCELLED"].includes(p.status));
      const lines: AssistantLink[] = [];
      for (const p of projects.slice(0, 5)) {
        const detail = await getCustomerProject(p.id);
        const next = detail?.milestones
          .filter((m) => !m.completedDate && m.status !== "COMPLETED")
          .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0];
        if (next) lines.push({ href: `/support/projects/${p.id}`, label: `${p.name}: ${next.name}${next.dueDate ? `, due ${formatDate(next.dueDate)}` : ""}` });
      }
      return lines.length ? { text: "The next milestone on each active project:", links: lines } : { text: "There are no upcoming milestones on your projects." };
    }

    case "deliverable": {
      const projects = await listCustomerProjects();
      const links: AssistantLink[] = [];
      for (const p of projects.slice(0, 5)) {
        const detail = await getCustomerProject(p.id);
        for (const d of detail?.deliverables ?? []) {
          links.push({ href: d.link || `/support/projects/${p.id}`, label: `${d.name} (${p.name}) · ${d.status === "SUBMITTED" ? "waiting for your approval" : humanize(d.status).toLowerCase()}` });
        }
      }
      return links.length
        ? { text: "Your deliverables. Each opens where you can find it:", links: links.slice(0, 8) }
        : { text: "Nothing has been handed over to you yet." };
    }

    case "search": {
      const terms = searchTerms(intent.query);
      const articles = terms ? await listArticles(terms) : [];
      const fallback = articles.length || !terms ? articles : await listArticles(terms.split(" ")[0]);
      if (fallback.length) {
        return {
          text: "These help articles may answer that:",
          links: fallback.slice(0, 3).map((a) => ({ href: `/support/knowledge/${a.id}`, label: a.title })),
          offerEscalation: true,
        };
      }
      return { text: "I am not sure about that one.", offerEscalation: true };
    }
  }
}

async function answerPartner(text: string, isAdmin: boolean): Promise<AssistantReply> {
  const intent = partnerIntent(text);
  switch (intent.kind) {
    case "greeting":
      return { text: "Hello! I can show your deals and commission, or start a deal registration.", suggestions: PARTNER_SUGGESTIONS };

    case "register_deal":
      return {
        text: "Register a deal by adding the customer, then the deal. It is protected for you from the day it is registered.",
        links: [{ href: "/portal/deals/new", label: "Register a deal" }, { href: "/portal/customers/new", label: "Add a customer first" }],
      };

    case "my_deals": {
      const open = (await getPortalDeals()).filter((d) => !["CLOSED_WON", "CLOSED_LOST"].includes(d.stage as string));
      if (!open.length) return { text: "You have no open deals.", links: [{ href: "/portal/deals/new", label: "Register a deal" }] };
      return {
        text: `You have ${open.length} open deal${open.length === 1 ? "" : "s"}${open.length > 6 ? " - the newest six" : ""}:`,
        links: open.slice(0, 6).map((d) => ({ href: `/portal/deals/${d.id}`, label: `${d.name} · ${humanize(d.stage as string)} · ${formatMoneyPlain(d.amount as number, d.currencyCode as string)}` })),
      };
    }

    case "deal_status": {
      const deals = await getPortalDeals();
      const ref = intent.reference?.toLowerCase() ?? null;
      const found = ref
        ? deals.find((d) => String(d.opportunityNumber).toLowerCase() === ref || String(d.name).toLowerCase().includes(ref))
        : null;
      if (!found) {
        return { text: ref ? `I could not find "${intent.reference}" among your deals.` : "Which deal? Give me its number (OPP-…) or its name in quotes.", suggestions: ["Show my opportunities"] };
      }
      return {
        text: `${found.name} (${found.opportunityNumber}) is at ${humanize(found.stage as string).toLowerCase()}${found.expectedCloseDate ? `, expected to close ${formatDate(found.expectedCloseDate as string)}` : ""}.`,
        links: [{ href: `/portal/deals/${found.id}`, label: `Open ${found.opportunityNumber}` }],
      };
    }

    case "commission_pending": {
      if (!isAdmin) return { text: "Commission is shown to your company's portal Admins. Ask one of them, or your partner manager." };
      const summary = await getPortalSummary();
      return {
        text: summary.owedCount > 0
          ? `${formatMoneyPlain(summary.owedTotal, summary.currency)} is owed to you on ${summary.owedCount} won deal(s), not yet paid. ${formatMoneyPlain(summary.paidTotal, summary.currency)} has been paid so far.`
          : `Nothing is owed to you right now. ${formatMoneyPlain(summary.paidTotal, summary.currency)} has been paid so far.`,
        links: [{ href: "/portal/commissions", label: "See your commission" }],
      };
    }

    case "commission_terms": {
      if (!isAdmin) return { text: "Your commission terms are shown to your company's portal Admins. Ask one of them, or your partner manager." };
      const p = await getPartnerProfile();
      const tax = p.withholdingTaxPercent ? ` ${formatPercent(p.withholdingTaxPercent, 2)} withholding tax is deducted before payment.` : "";
      return {
        text: `You earn ${formatPercent(p.defaultCommissionPercent, 2)} of each deal's final amount, after discounts, tax included.${tax} The payment date is 90 days after a deal is won, and you are paid in ${p.payoutCurrencyCode}.`,
        links: [{ href: "/portal/account", label: "Your partnership" }],
      };
    }

    case "support":
      return {
        text: "Support questions go to your partner manager. I can pass this conversation on to them, or you can write to them directly.",
        links: [{ href: "/portal/activities", label: "Message your partner manager" }],
        offerEscalation: true,
      };

    case "unknown":
      return { text: "I am not sure about that one.", suggestions: PARTNER_SUGGESTIONS, offerEscalation: true };
  }
}

/** Raises a case from the assistant: customers only, through the portal's own path. */
export async function assistantRaiseCase(input: {
  subject: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  transcript: string;
}): Promise<ActionResult<{ id: string; caseNumber: string }>> {
  return raiseTicketFromAssistant(input);
}

/**
 * Passes the conversation to a person: a case for a customer, a message to the
 * partner manager for a partner.
 */
export async function escalateConversation(transcript: string): Promise<ActionResult<{ text: string; href: string }>> {
  const me = await requireUser();
  const body = transcript.trim().slice(0, 8000);
  if (!body) return { ok: false, error: "There is nothing to send yet." };
  if (me.userType === "CUSTOMER") {
    const firstQuestion = body.split("\n").find((l) => l.startsWith("You:"))?.slice(4).trim() || "Question from the portal assistant";
    const result = await raiseTicketFromAssistant({ subject: firstQuestion.slice(0, 200), description: "Passed on from the portal assistant.", priority: "MEDIUM", transcript: body });
    if (!result.ok) return result;
    return { ok: true, data: { text: `Your case ${result.data.caseNumber} has been created. The support team has been notified.`, href: `/support/tickets/${result.data.id}` } };
  }
  if (me.userType === "PARTNER") {
    const result = await postPartnerMessage({ body: `From the portal assistant:\n\n${body}` });
    if (!result.ok) return result;
    return { ok: true, data: { text: "Sent to your partner manager. Their answer will show under Activities.", href: "/portal/activities" } };
  }
  return { ok: false, error: "The assistant is for the customer and partner portals." };
}
