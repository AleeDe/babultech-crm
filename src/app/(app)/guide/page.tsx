import Link from "next/link";
import {
  UserPlus, Building2, Target, FileText, FileSignature, Package,
  Megaphone, Handshake, LifeBuoy, FolderKanban, Receipt, Banknote,
  Clock, CalendarCheck, ArrowRight, CheckSquare, ShieldCheck, Settings,
  UsersRound, Coins, FileInput, Wallet, Stamp, type LucideIcon,
} from "lucide-react";
import { requireUser, can, PERMISSIONS, type SessionUser } from "@/lib/authz";
import { getMyReportingLine } from "@/server/users";
import { GuideSection } from "./guide-sections";
import { ExpenseFlowDiagram } from "./expense-flow-diagram";
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
  needs?: string | string[];
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
  /** Several permissions means any one of them is enough. */
  needs?: string | string[];
}

const REFERENCE: Reference[] = [
  {
    icon: Stamp,
    title: "Approvals",
    href: "/approvals",
    needs: [
      PERMISSIONS.QUOTATION_APPROVE,
      PERMISSIONS.INVOICE_APPROVE,
      PERMISSIONS.TIME_APPROVE,
      PERMISSIONS.COMMISSION_APPROVE,
    ],
    body: "Everything waiting on a decision from you, gathered from quotations, expenses, timesheets, vendor bills and commission - oldest first. Each one opens where the decision is actually made, because that screen has the context.",
  },
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
    body: "Raised against an account, optionally against a project. Every case has a conversation - customer messages, your replies and internal notes - and posting can move the case at the same time. The SLA clock pauses while you are waiting on the customer, and the deadline can be extended by exactly that time.",
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
    body: "Utilisation across the delivery team - who is booked, who is billable, and who has capacity. A report, not a place to assign work.",
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
    body: "What suppliers invoice you. A bill is entered, approved, then paid - approval is what makes it payable, and a payment against it updates the balance automatically.",
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
    body: "Everyone with access. The role decides what they can do; the data scope decides how much of it they see. Partner logins are marked separately - they reach the portal, not this app.",
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
    return "You are on the delivery side. Start at My work - it gathers your tasks, projects and cases in one place.";
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

  // A section can name several permissions when any one of them opens the
  // screen — the approvals queue is reachable by four different approvers.
  const allowed = (needs?: string | string[]) => {
    if (!needs) return true;
    return Array.isArray(needs) ? needs.some((n) => can(me, n)) : can(me, needs);
  };
  const line = await getMyReportingLine();

  const flow = FLOW.filter((step) => allowed(step.needs));
  const reference = REFERENCE.filter((item) => allowed(item.needs));

  // DEPARTMENT is the reporting line, not the department roster, so the wording
  // has to say "people who report to you" rather than "your department".
  const scopeExplainer: Record<string, string> = {
    OWN: "records you own",
    TEAM: "your team's records",
    DEPARTMENT: "your own records and those of everyone who reports to you",
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
        <GuideSection
          title={flow.length === FLOW.length ? "How a deal becomes money" : "The path, as it concerns you"}
          summary={`${flow.length} steps, in the order they happen`}
          defaultOpen
        >
          <div className="-mx-5 -mb-5 space-y-0">
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
          </div>
        </GuideSection>
      )}

      <GuideSection
        title={flow.length > 0 ? "Every other screen" : "Your screens"}
        summary={`${reference.length} screens you have access to`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
      </GuideSection>

      {can(me, PERMISSIONS.EXPENSE_READ) && (
        <GuideSection
          title="How an expense gets paid"
          summary="Two statuses, not one — and why approving a claim does not settle it"
        >
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              An expense carries two statuses that move independently. The first asks whether the
              claim is allowed; the second asks whether the money has actually gone out. Reading
              them as one sequence is what makes approved expenses look finished when they are not.
            </p>

            <ExpenseFlowDiagram />

            <p>
              <strong className="text-foreground">Approving is half the job.</strong>{" "}
              After approving, select the rows again and use Settle - or open the expense and use
              Mark as settled. The <strong className="text-foreground">Approved, unpaid</strong>{" "}
              tile at the top of Expenses is the shortest way back to everything still waiting,
              and it is the number to watch if you want to know what you owe your own people.
            </p>
            <p>
              <strong className="text-foreground">Neither final state can be undone.</strong>{" "}
              An approved claim cannot be un-approved and a settled one cannot be un-settled, on
              purpose: a reimbursement that can be walked back is a reimbursement that can be paid
              twice. Fix a mistake with a correcting entry rather than by editing history.
            </p>
            <p>
              <strong className="text-foreground">You cannot approve your own claim.</strong>{" "}
              The system refuses it whoever you are, administrators included, so the person who
              spends the money is never the person who signs it off.
            </p>
          </div>
        </GuideSection>
      )}

      <GuideSection
        title="Who can see what"
        summary="Why your lists show what they show, and who else can see the same rows"
      >
        <div className="space-y-5 text-sm">
          <p className="text-muted-foreground">
            Two separate things decide what you can do here, and it helps to keep them apart.
            Your <strong className="text-foreground">role</strong> decides which screens and
            buttons you get. Your <strong className="text-foreground">data scope</strong> decides
            whose records appear on those screens. You have exactly one role, and it carries
            exactly one scope - there is no way to hold two at once, which is deliberate: a second
            role would quietly widen what you can see rather than adding to what you can do.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4 font-medium">Scope</th>
                  <th className="pb-2 pr-4 font-medium">You see</th>
                  <th className="pb-2 font-medium">Typically</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                {[
                  ["Own", "Only records you own or are assigned.", "Consultants, sales executives"],
                  ["Team", "Everyone you share a team with.", "Managers of a working team"],
                  ["Department", "Yourself, plus everyone who reports to you - however far down.", "Heads of department"],
                  ["All", "Every record in the system.", "Administrators only"],
                ].map(([scope, sees, who]) => {
                  const mine = scope.toUpperCase() === me.dataScope;
                  return (
                    <tr key={scope} className={mine ? "bg-primary/5" : undefined}>
                      <td className="border-b py-2 pr-4 align-top">
                        <span className={mine ? "font-semibold text-foreground" : "font-medium"}>
                          {scope}
                        </span>
                        {mine && <Badge tone="info" className="ml-2">Yours</Badge>}
                      </td>
                      <td className="border-b py-2 pr-4 align-top">{sees}</td>
                      <td className="border-b py-2 align-top">{who}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="font-medium text-foreground">Your position</p>
            <p className="mt-1.5 text-muted-foreground">
              You are <strong className="text-foreground">{me.fullName}</strong>, signed in as{" "}
              <strong className="text-foreground">{me.roleName}</strong>, and you see{" "}
              {scopeExplainer[me.dataScope] ?? me.dataScope.toLowerCase()}.
              {line.managerName && (
                <> You report to <strong className="text-foreground">{line.managerName}</strong>.</>
              )}
              {line.directReports.length > 0 ? (
                <>
                  {" "}
                  <strong className="text-foreground">{line.directReports.join(", ")}</strong>{" "}
                  {line.directReports.length === 1 ? "reports" : "report"} to you
                  {line.totalBelow > line.directReports.length && (
                    <> ({line.totalBelow} people in total once their own reports are counted)</>
                  )}
                  .
                </>
              ) : (
                <> Nobody currently reports to you.</>
              )}
            </p>
          </div>

          <div>
            <p className="font-medium text-foreground">
              Department scope follows the reporting line, not the department list
            </p>
            <p className="mt-1.5 text-muted-foreground">
              This is the part people get wrong. Being in the same department as somebody does not
              let you see their work. Visibility follows{" "}
              <strong className="text-foreground">who reports to whom</strong>, and it only ever
              flows downward:
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li>• A manager sees their own records and everyone beneath them, however many levels down.</li>
              <li>• You never see your own manager&apos;s records.</li>
              <li>• Two people reporting to the same manager cannot see each other&apos;s work.</li>
              <li>• If nobody reports to you, you see only your own records.</li>
            </ul>
            <p className="mt-2 text-muted-foreground">
              So a department head sees the whole department because the department reports to
              them - not because they share a label. Reporting lines are set per person under
              Users, on the <strong className="text-foreground">Reports to</strong> field.
            </p>
          </div>

          <div>
            <p className="font-medium text-foreground">Some things nobody can do, whatever their role</p>
            <p className="mt-1.5 text-muted-foreground">
              A few rules are enforced on the action itself rather than by your permissions, so
              they hold even for an administrator. The clearest one: you cannot approve your own
              expense claim. Somebody else has to, and the system refuses it regardless of who is
              asking. Rules like that exist so that the person who spends the money is never the
              person who signs it off.
            </p>
          </div>
        </div>
      </GuideSection>

      <GuideSection
        title="Things that catch people out"
        summary="Why a list looks empty, where the dropdowns come from, and who sees what"
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Quotations and invoices email out.</strong>{" "}
            Open one and use Send to customer. The number, dates and totals are appended for you,
            and sending moves the record to Sent. Every attempt is logged on the record - including
            failures - so &quot;did anyone send this?&quot; has an answer.
          </p>
          <p>
            <strong className="text-foreground">Every list exports to CSV.</strong>{" "}
            The Export button sends what you are currently looking at, filters and all - not the
            whole table. Amounts and dates come out as raw values so a spreadsheet can sum and sort
            them, and the file only ever contains rows your role can already see.
          </p>
          <p>
            <strong className="text-foreground">Notes and documents sit on every record.</strong>{" "}
            Open an account, deal, project or case and you will find both at the bottom. A note can
            be private to you, shared with your team, or open to everyone. Attachments are stored
            privately - links are generated when you open one and expire shortly after, so nothing
            is left permanently reachable.
          </p>
          <p>
            <strong className="text-foreground">What you see depends on your role.</strong>{" "}
            Yours shows {scopeExplainer[me.dataScope] ?? me.dataScope.toLowerCase()}. If a list
            looks emptier than you expect, that is usually why - the rows exist, they are just not
            yours to see.
          </p>

          {can(me, PERMISSIONS.PROJECT_READ) && (
            <p>
              <strong className="text-foreground">
                Projects have a board, and tasks have pages.
              </strong>{" "}
              Drag a card between columns to move a task. Click its name to open the task itself,
              acceptance criteria, booked time, subtasks, notes and documents. Further down sit
              risks (something that might happen, scored by probability × impact), issues
              (something that already has), and change requests, where scope added after kickoff
              shows its cost and its days next to the request rather than as a missed date at the
              end.
            </p>
          )}

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
              their own deals, referrals and commission - never another partner&apos;s, and never
              your customer list. Customers have no login at all; they exist here as account
              records.
            </p>
          )}

          {can(me, PERMISSIONS.ADMIN) && (
            <p>
              <strong className="text-foreground">Dropdowns come from Settings.</strong>{" "}
              Currencies, tax rates, departments, categories - and the email branding and wording
              customers see - are all editable under{" "}
              <Link href="/settings" className="text-primary hover:underline">Settings</Link>, and
              every form picks the change up. Roles and data scopes are set per user under{" "}
              <Link href="/users" className="text-primary hover:underline">Users</Link>.
            </p>
          )}
        </div>
      </GuideSection>
    </>
  );
}
