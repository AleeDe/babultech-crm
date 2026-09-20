import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { listMyCustomers } from "@/server/partner-customers";
import {
  PageHeader, Card, CardContent, CardHeader, CardTitle, Badge, Button,
  EmptyState, StatTile, Alert, statusTone,
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

/**
 * The customers this partner brought us.
 *
 * Not the same list as /portal/accounts, which shows the customers behind deals
 * they are attached to. A partner can be on a deal at a customer that was
 * always ours; that customer appears there and not here, because only the ones
 * they sourced are theirs to add people and deals to.
 */
export default async function PortalCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const [customers, { created }] = await Promise.all([listMyCustomers(), searchParams]);

  const contested = customers.filter((c) => c.registrationContested);
  const totalDeals = customers.reduce(
    (sum, c) => sum + (Array.isArray(c.opportunities) ? c.opportunities.length : 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Your customers"
        description="The organisations you brought us. Add their people and their deals here."
      >
        <Button asChild>
          <Link href="/portal/customers/new">
            <Plus className="h-4 w-4" /> Add a customer
          </Link>
        </Button>
      </PageHeader>

      {created && (
        <div className="mb-5">
          <Alert tone="success">
            Customer <strong>{created}</strong> created. Your partner manager has been given the
            account and will be in touch.
          </Alert>
        </div>
      )}

      {contested.length > 0 && (
        <div className="mb-5">
          <Alert tone="warning">
            <span className="font-medium">
              {contested.length === 1
                ? "One of your customers is contested."
                : `${contested.length} of your customers are contested.`}
            </span>{" "}
            They matched a customer we already knew. We are looking into who holds the relationship
            and will come back to you.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Customers" value={String(customers.length)} />
        <StatTile label="Deals" value={String(totalDeals)} tone="info" />
        <StatTile
          label="Contested"
          value={String(contested.length)}
          tone={contested.length ? "warning" : "neutral"}
        />
      </div>

      <div className="mt-6 space-y-4">
        {customers.length === 0 ? (
          <Card>
            <CardContent className="py-10">
              <EmptyState
                title="No customers yet"
                description="When you win a customer, add them here. We create the account and their contact, and credit you as the partner who brought them."
                action={
                  <Button asChild>
                    <Link href="/portal/customers/new">
                      <Plus className="h-4 w-4" /> Add your first customer
                    </Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          customers.map((customer) => {
            const contacts = Array.isArray(customer.contacts) ? customer.contacts : [];
            const deals = Array.isArray(customer.opportunities) ? customer.opportunities : [];
            const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];

            return (
              <Card key={customer.id}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {customer.name}
                      <Badge tone="neutral">{humanize(customer.accountType)}</Badge>
                      {customer.registrationContested && (
                        <Badge tone="warning">
                          <AlertTriangle className="mr-1 inline h-3 w-3" />
                          Contested
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {customer.accountNumber}
                      {customer.industry && ` · ${customer.industry}`}
                      {` · added ${formatDate(customer.createdAt)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/portal/customers/${customer.id}/contact`}>Add a person</Link>
                    </Button>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/portal/customers/${customer.id}/deal`}>Add a deal</Link>
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="grid gap-5 text-sm sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      People ({contacts.length})
                    </p>
                    {contacts.length === 0 ? (
                      <p className="text-muted-foreground">Nobody recorded yet.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {contacts.map((c) => (
                          <li key={c.id}>
                            <span className="font-medium">
                              {c.firstName} {c.lastName}
                            </span>
                            {c.id === primary?.id && (
                              <Badge tone="neutral" className="ml-2">Primary</Badge>
                            )}
                            <span className="block text-xs text-muted-foreground">
                              {[c.jobTitle, c.email, c.phone].filter(Boolean).join(" · ") ||
                                "No details recorded"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Deals ({deals.length})
                    </p>
                    {deals.length === 0 ? (
                      <p className="text-muted-foreground">No deals yet.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {deals.map((d) => (
                          <li key={d.id} className="flex flex-wrap items-baseline gap-2">
                            <span className="font-medium">{d.name}</span>
                            <Badge tone={statusTone(d.stage)}>{humanize(d.stage)}</Badge>
                            <span className="text-xs tabular text-muted-foreground">
                              {formatMoney(d.amount, d.currencyCode)}
                              {d.expectedCloseDate && ` · ${formatDate(d.expectedCloseDate)}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}
