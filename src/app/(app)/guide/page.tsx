import Link from "next/link";
import {
  UserPlus, Building2, Target, FileText, FileSignature, Package,
  Megaphone, Handshake, LifeBuoy, FolderKanban, Receipt, Banknote,
  Clock, CalendarCheck, ArrowRight, CheckSquare, ShieldCheck, Settings,
  UsersRound, Coins, FileInput, Wallet, type LucideIcon,
} from "lucide-react";
import { requireUser, can, PERMISSIONS, type SessionUser } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Alert,
} from "@/components/ui";

/**
 * How the modules fit together, for the reader's own role.
 *
 * A guide that lists everything is a guide nobody finishes: a consultant does
 * not need the quote-to-contract path, and a finance user does not assign
 * tasks. Every section declares what permission it belongs to and is dropped
 * for anyone without it — the same `can()` the screens themselves use, so the
 * guide can never describe a page the reader would be refused.
 */

interface Step {
  icon: LucideIcon;
  title: string;
  href: string;
  what: string;
  how: string;
  then: string;
  needs?: string;
  optional?: boolean;
}

const FLOW: Step[] = [
  {
    icon: Megaphone,
    title: "Campaign",
    href: "/campaigns",
    needs: PERMISSIONS.LEAD_READ,
    what: "A marketing push you want to attribute results to.",
    how: "Campaigns › New campaign. Give it a type, budget and dates.",
    then: "Leads created afterwards can point back at it, so you can see what the spend returned.",
    optional: true,
  },
  {
    icon: UserPlus,
    title: "Lead",
    href: "/leads",
    needs: PERMISSIONS.LEAD_READ,
    what: "Someone who might buy, before you know whether they will.",
    how: "Leads › New lead. Name and owner are the only required fields.",
    then: "Qualify it, then convert. Converting creates the account, the contact and the opportunity together, and links all three.",
  },
  {
    icon: Building2,
    title: "Account & contact",
    href: "/accounts",
    needs: PERMISSIONS.ACCOUNT_READ,
    what: "The organisation you sell to, and the people inside it. A customer is an account with its type set to Customer.",
    how: "Usually created for you when a lead converts. You can also add one directly from Accounts › New account.",
    then: "Contacts live under an account. One of them is the primary.",
  },
  {
    icon: Target,
    title: "Opportunity",
    href: "/opportunities",
    needs: PERMISSIONS.OPPORTUNITY_READ,
    what: "A specific deal, with an amount and an expected close date.",
    how: "Opportunities › New opportunity, or automatically on lead conversion.",
    then: "Move it through the stages as it progresses. Add products to build up the value.",
  },
  {
    icon: FileText,
    title: "Quotation",
    href: "/quotations",
    needs: PERMISSIONS.OPPORTUNITY_READ,
    what: "The priced proposal you send the customer.",
    how: "Open the opportunity and raise a quote from there, so it inherits the account and contact.",
    then: "Quote lines pull their price from the product catalogue. Revising a quote creates a new version rather than overwriting the old one.",
  },
  {
    icon: FileSignature,
    title: "Contract",
    href: "/contracts",
    needs: PERMISSIONS.OPPORTUNITY_READ,
    what: "What was agreed once the quote is accepted.",
    how: "Contracts › New contract, linked to the accepted quotation.",
    then: "Sets the billing frequency and renewal terms that invoicing follows.",
  },
  {
    icon: FolderKanban,
    title: "Project",
    href: "/projects",
    needs: PERMISSIONS.PROJECT_READ,
    what: "Delivery of what was sold.",
    how: "Projects › New project, against the account and the won opportunity.",
    then: "Add phases, milestones and members. Time logged against tasks becomes billable.",
  },
  {
    icon: Receipt,
    title: "Invoice & payment",
    href: "/invoices",
    needs: PERMISSIONS.INVOICE_READ,
    what: "Asking for the money, and recording it when it arrives.",
    how: "Invoices › New invoice. Raise it against the account, project or milestone.",
    then: "Record a payment and allocate it to the invoice. Partner commission accrues on what is actually collected.",
  },
];

interface Reference {
  icon: LucideIcon;
  title: string;
  href: string;
  body: string;
  needs?: string;
}

const REFERENCE: Reference[] = [
  {
    icon: CheckSquare,
    title: "My work",
    href: "/my-work",
    body: "Everything assigned to you, in one place: tasks, the projects you are booked on, your cases and activities, and the hours you have logged this week. You can move your own tasks along from here without opening each project.",
  },
  {
    icon: Package,
    title: "Products",
    href: "/products",
    needs: PERMISSIONS.OPPORTUNITY_READ,
    body: "The catalogue quote and invoice lines price from. Set a standard price, a cost and a commission percentage per item.",
  },
  {
    icon: Handshake,
    title: "Partners",
    href: "/partners",
    needs: PERMISSIONS.PARTNER_READ,
    body: "Companies and individuals who source or deliver deals. Register a partner against an opportunity to make them eligible for commission on it.",
  },
  {
    icon: Coins,
    title: "Commission",
    href: "/commissions",
    needs: PERMISSIONS.COMMISSION_READ,
    body: "What each partner has earned, and on what. Commission accrues from the plan attached to the partner or the deal, and is approved before it can be paid out.",
  },
  {
    icon: LifeBuoy,
    title: "Support cases",
    href: "/cases",
    needs: PERMISSIONS.CASE_READ,
    body: "Raised against an account, optionally against a project. SLA timers run from the priority and the policy attached.",
  },
  {
    icon: Clock,
    title: "Timesheets",
    href: "/timesheets",
    needs: PERMISSIONS.PROJECT_READ,
    body: "Time logged against project tasks. Submitted, then approved, before it can be billed. Unlogged hours cost the project nothing and make utilisation read low.",
  },
  {
    icon: UsersRound,
    title: "Resources",
    href: "/resources",
    needs: PERMISSIONS.PROJECT_READ,
    body: "Utilisation across the delivery team — who is booked, who is billable, and who has capacity. A report, not a place to assign work.",
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
    needs: PERMISSIONS.INVOICE_READ,
    body: "Money received, allocated against one or more invoices. A payment can sit unallocated until you decide where it belongs.",
  },
  {
    icon: FileInput,
    title: "Vendor bills",
    href: "/vendor-bills",
    needs: PERMISSIONS.INVOICE_READ,
    body: "What suppliers invoice you. A bill is entered, approved, then paid — approval is what makes it payable, and a payment against it updates the balance automatically.",
  },
  {
    icon: Wallet,
    title: "Expenses",
    href: "/expenses",
    needs: PERMISSIONS.INVOICE_READ,
    body: "What the business spends. Submitted, then approved by someone else, then settled. An expense on a project can be marked billable and recharged to the customer.",
  },
  {
    icon: ShieldCheck,
    title: "Users",
    href: "/users",
    needs: PERMISSIONS.ADMIN,
    body: "Everyone with access. The role decides what they can do; the data scope decides how much of it they see. Partner logins are marked separately — they reach the portal, not this app.",
  },
  {
    icon: Settings,
    title: "Settings",
    href: "/settings",
    needs: PERMISSIONS.ADMIN,
    body: "The lists every dropdown is built from: currencies, tax rates, departments, case and expense categories. Change them here and the forms follow.",
  },
];

/** A one-line orientation for the reader, chosen by what they can actually do. */
function openingFor(me: SessionUser): string {
  if (can(me, PERMISSIONS.ADMIN)) {
    return "You have full access. This covers every module, in the order records are normally created.";
  }
  if (can(me, PERMISSIONS.PROJECT_WRITE) && !can(me, PERMISSIONS.OPPORTUNITY_WRITE)) {
    return "You are on the delivery side. Start at My work — it gathers your tasks, projects and cases in one place.";
  }
  if (can(me, PERMISSIONS.INVOICE_WRITE) && !can(me, PERMISSIONS.OPPORTUNITY_WRITE)) {
    return "You handle invoicing and payments. The sections below cover where an invoice comes from and what happens after it is paid.";
  }
  if (can(me, PERMISSIONS.OPPORTUNITY_WRITE)) {
    return "You work the pipeline. The path below runs from a first lead through to the money arriving.";
  }
  return "This covers the parts of the system your role gives you access to.";
}

export default async function GuidePage() {
  const me = await requireUser();

  const allowed = (needs?: string) => !needs || can(me, needs);
  const flow = FLOW.filter((step) => allowed(step.needs));
  const reference = REFERENCE.filter((item) => allowed(item.needs));

  const scopeExplainer: Record<string, string> = {
    OWN: "records you own",
    TEAM: "your team's records",
    DEPARTMENT: "your department's records",
    ALL: "every record in the system",
  };

  return (
    <>
      <PageHeader
        title="User guide"
        description={openingFor(me)}
      />

      <div className="mb-6">
        <Alert tone="info">
          You are signed in as <strong>{me.roleName}</strong>, which sees{" "}
          <strong>{scopeExplainer[me.dataScope] ?? me.dataScope.toLowerCase()}</strong>. This guide
          only describes the parts of the system that role can reach, so a colleague on a different
          role will see a different page here.
        </Alert>
      </div>

      {flow.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              {flow.length === FLOW.length ? "The main path" : "The path, as it concerns you"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            {flow.map((step, i) => (
              <div key={step.title} className="flex gap-4 border-b p-5 last:border-0">
                <div className="flex flex-col items-center">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <step.icon className="h-4 w-4" />
                  </span>
                  {i < flow.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
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
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {flow.length > 0 ? "Everything else" : "Your screens"}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reference.map((r) => (
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
          <CardTitle>Worth knowing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Every list exports to CSV.</strong>{" "}
            The Export button sends what you are currently looking at, filters and all — not the
            whole table. Amounts and dates come out as raw values so a spreadsheet can sum and sort
            them, and the file only ever contains rows your role can already see.
          </p>
          <p>
            <strong className="text-foreground">Notes and documents sit on every record.</strong>{" "}
            Open an account, deal, project or case and you will find both at the bottom. A note can
            be private to you, shared with your team, or open to everyone. Attachments are stored
            privately — links are generated when you open one and expire shortly after, so nothing
            is left permanently reachable.
          </p>
          <p>
            <strong className="text-foreground">What you see depends on your role.</strong>{" "}
            Yours shows {scopeExplainer[me.dataScope] ?? me.dataScope.toLowerCase()}. If a list
            looks emptier than you expect, that is usually why — the rows exist, they are just not
            yours to see.
          </p>

          {can(me, PERMISSIONS.PROJECT_READ) && (
            <p>
              <strong className="text-foreground">Delivery work starts at My work.</strong>{" "}
              The project screens are organised by project, which suits whoever is running one.{" "}
              <Link href="/my-work" className="text-primary hover:underline">My work</Link> shows
              the same tasks, projects, cases and activities indexed by who they are assigned to,
              and lets you move your own tasks along without opening each project.
            </p>
          )}

          {can(me, PERMISSIONS.PARTNER_READ) && (
            <p>
              <strong className="text-foreground">Partners sign in somewhere else.</strong>{" "}
              An external partner logs in to the partner portal rather than this app, and sees only
              their own deals, referrals and commission — never another partner&apos;s, and never
              your customer list. Customers have no login at all; they exist here as account
              records.
            </p>
          )}

          {can(me, PERMISSIONS.ADMIN) && (
            <p>
              <strong className="text-foreground">Dropdowns come from Settings.</strong>{" "}
              Currencies, tax rates, departments and categories are editable lists under{" "}
              <Link href="/settings" className="text-primary hover:underline">Settings</Link>, and
              every form picks the change up. Roles and data scopes are set per user under{" "}
              <Link href="/users" className="text-primary hover:underline">Users</Link>.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
