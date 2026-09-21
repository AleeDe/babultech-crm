import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Building2, Plus, Target, Users } from "lucide-react";
import { getMyCustomer } from "@/server/partner-customers";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Button,
  Table, THead, TBody, TR, TH, TD, EmptyState, statusTone,
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

/** One label/value row, laid out as the CRM's account page lays them out. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * An account, as the partner who brought it sees it.
 *
 * The same shape as the CRM's account page — company details, contacts,
 * opportunities — minus the parts that are ours rather than theirs: the
 * internal owner, health, cases and invoices.
 */
export default async function PortalAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await getMyCustomer(id);

  // RLS returns nothing for an account this partner did not source, so a
  // missing row and a forbidden one look the same here — which is what we want
  // it to look like.
  if (!account) notFound();

  const address = (account.billingAddress ?? {}) as Record<string, string>;
  const addressLine = [address.street, address.city, address.state, address.postalCode, address.country]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        backTo="/portal/customers"
        backLabel="Back to accounts"
        title={account.name}
        description={account.accountNumber}
      >
        <Badge tone="neutral">{humanize(account.accountType)}</Badge>
        {account.customerStatus && (
          <Badge tone={statusTone(account.customerStatus)}>{humanize(account.customerStatus)}</Badge>
        )}
        {account.registrationContested && (
          <Badge tone="warning">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            Contested
          </Badge>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href={`/portal/customers/${account.id}/contact`}>
            <Plus className="h-4 w-4" /> Add employee
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/portal/customers/${account.id}/deal`}>
            <Plus className="h-4 w-4" /> New opportunity
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Company
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Detail label="Account number">{account.accountNumber}</Detail>
              <Detail label="Type">{humanize(account.accountType)}</Detail>
              {account.customerStatus && (
                <Detail label="Status">{humanize(account.customerStatus)}</Detail>
              )}
              <Detail label="Industry">{account.industry ?? "—"}</Detail>
              <Detail label="Phone">{account.mainPhone ?? "—"}</Detail>
              <Detail label="Website">
                {account.website ? (
                  <a href={account.website} target="_blank" rel="noopener noreferrer" className="underline">
                    {account.website}
                  </a>
                ) : (
                  "—"
                )}
              </Detail>
              <Detail label="Employees">{account.employeeCount ?? "—"}</Detail>
              <Detail label="Address">{addressLine || "—"}</Detail>
              <Detail label="Added">{formatDate(account.createdAt)}</Detail>
            </dl>
            {account.description && (
              <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">
                {account.description}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Contacts ({account.contacts.length})
            </CardTitle>
            <Button asChild size="sm" variant="outline">
              <Link href={`/portal/customers/${account.id}/contact`}>
                <Plus className="h-4 w-4" /> Add employee
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0">
            {account.contacts.length === 0 ? (
              <div className="px-6 pb-4">
                <EmptyState
                  title="Nobody recorded yet"
                  description="Add the people you deal with at this organisation."
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH priority="secondary">Job title</TH>
                    <TH priority="tertiary">Email</TH>
                    <TH priority="tertiary">Phone</TH>
                  </TR>
                </THead>
                <TBody>
                  {account.contacts.map((contact) => (
                    <TR key={contact.id}>
                      <TD>
                        <span className="text-sm font-medium">
                          {contact.firstName} {contact.lastName}
                        </span>
                        {contact.isPrimary && (
                          <Badge tone="neutral" className="ml-2">Primary</Badge>
                        )}
                      </TD>
                      <TD className="text-sm">{contact.jobTitle ?? "—"}</TD>
                      <TD className="text-sm">{contact.email ?? "—"}</TD>
                      <TD className="text-sm">{contact.phone ?? contact.mobile ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" /> Opportunities ({account.opportunities.length})
          </CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link href={`/portal/customers/${account.id}/deal`}>
              <Plus className="h-4 w-4" /> New opportunity
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          {account.opportunities.length === 0 ? (
            <div className="px-6 pb-4">
              <EmptyState
                title="No opportunities yet"
                description="Record what you are selling them, and we will pick it up from there."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Opportunity</TH>
                  <TH>Stage</TH>
                  <TH className="text-right">Value</TH>
                  <TH priority="secondary">Close date</TH>
                  <TH priority="tertiary">Next step</TH>
                </TR>
              </THead>
              <TBody>
                {account.opportunities.map((deal) => (
                  <TR key={deal.id}>
                    <TD>
                      <span className="text-sm font-medium">{deal.name}</span>
                      <p className="text-xs text-muted-foreground">{deal.opportunityNumber}</p>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(deal.stage)}>{humanize(deal.stage)}</Badge>
                    </TD>
                    <TD className="text-right tabular">
                      {formatMoney(deal.amount, deal.currencyCode)}
                    </TD>
                    <TD className="whitespace-nowrap text-sm">
                      {formatDate(deal.actualCloseDate ?? deal.expectedCloseDate)}
                    </TD>
                    <TD className="text-sm">{deal.nextStep ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
