import Link from "next/link";
import {
  UserPlus, Building2, Target, FileText, FileSignature, Package,
  Megaphone, Handshake, LifeBuoy, FolderKanban, Receipt, Banknote,
  Clock, CalendarCheck, ArrowRight,
} from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui";

/**
 * How the modules fit together.
 *
 * Written as a walkthrough rather than a feature list, because the thing people
 * get stuck on is not what a screen does — it is which screen comes first.
 */

const FLOW = [
  {
    icon: Megaphone,
    title: "Campaign",
    href: "/campaigns",
    what: "A marketing push you want to attribute results to.",
    how: "Campaigns › New campaign. Give it a type, budget and dates.",
    then: "Leads created afterwards can point back at it, so you can see what the spend returned.",
    optional: true,
  },
  {
    icon: UserPlus,
    title: "Lead",
    href: "/leads",
    what: "Someone who might buy, before you know whether they will.",
    how: "Leads › New lead. Name and owner are the only required fields.",
    then: "Qualify it, then convert. Converting creates the account, the contact and the opportunity together, and links all three.",
  },
  {
    icon: Building2,
    title: "Account & contact",
    href: "/accounts",
    what: "The organisation you sell to, and the people inside it.",
    how: "Usually created for you when a lead converts. You can also add one directly from Accounts › New account.",
    then: "Contacts live under an account. One of them is the primary.",
  },
  {
    icon: Target,
    title: "Opportunity",
    href: "/opportunities",
    what: "A specific deal, with an amount and an expected close date.",
    how: "Opportunities › New opportunity, or automatically on lead conversion.",
    then: "Move it through the stages as it progresses. Add products to build up the value.",
  },
  {
    icon: FileText,
    title: "Quotation",
    href: "/quotations",
    what: "The priced proposal you send the customer.",
    how: "Open the opportunity and raise a quote from there, so it inherits the account and contact.",
    then: "Quote lines pull their price from the product catalogue. Revising a quote creates a new version rather than overwriting the old one.",
  },
  {
    icon: FileSignature,
    title: "Contract",
    href: "/contracts",
    what: "What was agreed once the quote is accepted.",
    how: "Contracts › New contract, linked to the accepted quotation.",
    then: "Sets the billing frequency and renewal terms that invoicing follows.",
  },
  {
    icon: FolderKanban,
    title: "Project",
    href: "/projects",
    what: "Delivery of what was sold.",
    how: "Projects › New project, against the account and the won opportunity.",
    then: "Add phases, milestones and members. Time logged against tasks becomes billable.",
  },
  {
    icon: Receipt,
    title: "Invoice & payment",
    href: "/invoices",
    what: "Asking for the money, and recording it when it arrives.",
    how: "Invoices › New invoice. Raise it against the account, project or milestone.",
    then: "Record a payment and allocate it to the invoice. Partner commission accrues on what is actually collected.",
  },
];

const REFERENCE = [
  {
    icon: Package,
    title: "Products",
    href: "/products",
    body: "The catalogue quote and invoice lines price from. Set a standard price, a cost and a commission percentage per item.",
  },
  {
    icon: Handshake,
    title: "Partners",
    href: "/partners",
    body: "Companies and individuals who source or deliver deals. Register a partner against an opportunity to make them eligible for commission on it.",
  },
  {
    icon: LifeBuoy,
    title: "Support cases",
    href: "/cases",
    body: "Raised against an account, optionally against a project. SLA timers run from the priority and the policy attached.",
  },
  {
    icon: Clock,
    title: "Timesheets",
    href: "/timesheets",
    body: "Time logged against project tasks. Submitted, then approved, before it can be billed.",
  },
  {
    icon: CalendarCheck,
    title: "Activities",
    href: "/activities",
    body: "Calls, meetings, tasks and reminders. They attach to whatever record they concern.",
  },
  {
    icon: Banknote,
    title: "Payments",
    href: "/payments",
    body: "Money received, allocated against one or more invoices. A payment can sit unallocated until you decide where it belongs.",
  },
];

export default function GuidePage() {
  return (
    <>
      <PageHeader
        title="User guide"
        description="What each part of the system is for, and the order things happen in."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>The main path</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          {FLOW.map((step, i) => (
            <div key={step.title} className="flex gap-4 border-b p-5 last:border-0">
              <div className="flex flex-col items-center">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <step.icon className="h-4 w-4" />
                </span>
                {i < FLOW.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
              </div>

              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={step.href} className="font-semibold hover:underline">
                    {step.title}
                  </Link>
                  {step.optional && <Badge tone="neutral">Optional</Badge>}
                </div>

                <p className="mt-1 text-sm text-muted-foreground">{step.what}</p>

                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      To add
                    </dt>
                    <dd>{step.how}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Then
                    </dt>
                    <dd className="text-muted-foreground">{step.then}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Everything else
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REFERENCE.map((r) => (
          <Card key={r.title}>
            <CardContent className="p-5">
              <Link href={r.href} className="flex items-center gap-2 font-semibold hover:underline">
                <r.icon className="h-4 w-4 text-muted-foreground" />
                {r.title}
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <p className="mt-2 text-sm text-muted-foreground">{r.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Two things worth knowing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">What you see depends on your role.</strong>{" "}
            A data scope of Own shows only your records, Team adds your team&apos;s, and All shows
            everything. If a list looks emptier than you expect, that is usually why.
          </p>
          <p>
            <strong className="text-foreground">Dropdowns come from Settings.</strong>{" "}
            Currencies, tax rates, departments and categories are all editable lists — an
            administrator can change them under{" "}
            <Link href="/settings" className="text-primary hover:underline">Settings</Link>, and
            every form picks the change up.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
