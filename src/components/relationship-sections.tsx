import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent, Badge, statusTone, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { formatMoney, formatMoneyTotal, formatDate, humanize } from "@/lib/utils";
import type {
  AccountRelationship, ContactRelationship, MoneyByCurrency, RelatedLead, RelatedProject, RelatedDeal, RelatedCase,
} from "@/server/relationship";

/**
 * The relationship sections of the account and contact pages: who came in as
 * a lead, what was bought, which campaigns reached them, their projects, deals
 * and cases. The data comes from server/relationship.ts.
 */

function Money({ list, empty = "—" }: { list: MoneyByCurrency[]; empty?: string }) {
  if (!list.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="space-y-0.5">
      {list.map((m) => (
        <span key={m.currency} className="block tabular">{formatMoneyTotal(m.amount, m.currency)}</span>
      ))}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 pb-2 text-sm text-muted-foreground">{children}</p>;
}

const VIA: Record<string, string> = { deal: "a deal", lead: "a lead", contact: "a contact", member: "campaign list" };

export function AccountRelationshipSections({ data }: { data: AccountRelationship }) {
  const { revenue } = data;
  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Revenue</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {revenue.wonDeals === 0
              ? "Nothing won yet."
              : `${revenue.wonDeals} deal(s) won${revenue.firstWonAt ? `, a customer since ${formatDate(revenue.firstWonAt)}` : ""}.`}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Won</p>
            <p className="mt-0.5 font-medium"><Money list={revenue.won} /></p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Invoiced</p>
            <p className="mt-0.5 font-medium"><Money list={revenue.invoiced} /></p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Paid</p>
            <p className="mt-0.5 font-medium"><Money list={revenue.paid} /></p>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Products and services bought</CardTitle></CardHeader>
          <CardContent className="px-0">
            {data.products.length === 0 ? (
              <Empty>Nothing bought yet - this fills in from the lines on won deals.</Empty>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Item</TH>
                    <TH className="text-right">Quantity</TH>
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.products.map((p) => (
                    <TR key={p.productId ?? p.name}>
                      <TD className="text-sm">
                        {p.productId ? <Link href={`/products/${p.productId}`} className="font-medium hover:underline">{p.name}</Link> : <span className="font-medium">{p.name}</span>}
                        {p.lastWonAt && <p className="text-xs text-muted-foreground">Last won {formatDate(p.lastWonAt)}</p>}
                      </TD>
                      <TD className="text-right tabular text-sm">{p.quantity}</TD>
                      <TD className="text-right text-sm">
                        {p.totals.map((t) => <span key={t.currency} className="block whitespace-nowrap tabular">{formatMoney(t.amount, t.currency)}</span>)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Campaign influence</CardTitle></CardHeader>
          <CardContent className="px-0">
            {data.campaigns.length === 0 ? (
              <Empty>No campaign has reached this account yet.</Empty>
            ) : (
              <ul className="divide-y">
                {data.campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/campaigns/${c.id}`} className="text-sm font-medium hover:underline">{c.name}</Link>
                      <p className="text-xs text-muted-foreground">
                        {c.campaignNumber} · through {c.via.map((v) => VIA[v] ?? v).join(", ")}
                      </p>
                    </div>
                    <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ProjectsCard projects={data.projects} empty="No projects for this account." />
        <LeadsCard leads={data.leads} title="Leads that became this account" empty="No converted leads point at this account." />
      </div>
    </>
  );
}

export function ContactRelationshipSections({ data, accountName }: { data: ContactRelationship; accountName: string | null }) {
  return (
    <>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DealsCard deals={data.deals} />
        <CasesCard cases={data.cases} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ProjectsCard
          projects={data.projects}
          title={accountName ? `Projects (${accountName})` : "Projects"}
          empty="No projects concern them."
        />
        <LeadsCard leads={data.leads} title="Lead history" empty="They did not come in as a lead, and have not referred one." />
      </div>
    </>
  );
}

function ProjectsCard({ projects, title = "Projects", empty }: { projects: RelatedProject[]; title?: string; empty: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="px-0">
        {projects.length === 0 ? (
          <Empty>{empty}</Empty>
        ) : (
          <ul className="divide-y">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <Link href={`/projects/${p.id}`} className="text-sm font-medium hover:underline">{p.name}</Link>
                  <p className="text-xs text-muted-foreground">
                    {p.projectNumber} · {Math.round(p.completionPercent)}% done{p.plannedEndDate ? ` · due ${formatDate(p.plannedEndDate)}` : ""}
                  </p>
                </div>
                <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LeadsCard({ leads, title, empty }: { leads: RelatedLead[]; title: string; empty: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="px-0">
        {leads.length === 0 ? (
          <Empty>{empty}</Empty>
        ) : (
          <ul className="divide-y">
            {leads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <Link href={`/leads/${l.id}`} className="text-sm font-medium hover:underline">{l.name}</Link>
                  <p className="text-xs text-muted-foreground">
                    {l.leadNumber}{l.leadSource ? ` · ${humanize(l.leadSource)}` : ""} · {l.convertedAt ? `converted ${formatDate(l.convertedAt)}` : `added ${formatDate(l.createdAt)}`}
                  </p>
                </div>
                <Badge tone={statusTone(l.status)}>{humanize(l.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DealsCard({ deals }: { deals: RelatedDeal[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Deals</CardTitle></CardHeader>
      <CardContent className="px-0">
        {deals.length === 0 ? (
          <Empty>Not the main contact on any deal.</Empty>
        ) : (
          <ul className="divide-y">
            {deals.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <Link href={`/opportunities/${d.id}`} className="text-sm font-medium hover:underline">{d.name}</Link>
                  <p className="text-xs text-muted-foreground">
                    {d.opportunityNumber} · {formatMoney(d.amount, d.currencyCode)}{d.expectedCloseDate ? ` · close ${formatDate(d.expectedCloseDate)}` : ""}
                  </p>
                </div>
                <Badge tone={statusTone(d.stage)}>{humanize(d.stage)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CasesCard({ cases }: { cases: RelatedCase[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Cases</CardTitle></CardHeader>
      <CardContent className="px-0">
        {cases.length === 0 ? (
          <Empty>No support cases raised by them.</Empty>
        ) : (
          <ul className="divide-y">
            {cases.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <Link href={`/cases/${c.id}`} className="text-sm font-medium hover:underline">{c.subject}</Link>
                  <p className="text-xs text-muted-foreground">{c.caseNumber} · {humanize(c.priority)} · {formatDate(c.createdAt)}</p>
                </div>
                <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
