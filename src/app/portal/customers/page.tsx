import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { listMyCustomers } from "@/server/partner-customers";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, Button,
  EmptyState, StatTile, Alert,
} from "@/components/ui";
import { formatDate, humanize } from "@/lib/utils";

/**
 * The accounts this partner brought us.
 *
 * Laid out like the CRM's own account list rather than as portal-shaped cards:
 * a partner and a colleague discussing the same customer should be looking at
 * the same thing, in the same words. What is left out is what belongs to us
 * rather than to them — the internal owner, the health score, case counts and
 * anything financial.
 *
 * Only the accounts they sourced. A partner can be attached to an opportunity
 * at an account that was always ours; that one shows under Opportunities but
 * not here, because only the ones they brought are theirs to add to.
 */
export default async function PortalAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const [accounts, { created }] = await Promise.all([listMyCustomers(), searchParams]);

  const contested = accounts.filter((a) => a.registrationContested);
  const totalDeals = accounts.reduce(
    (sum, a) => sum + (Array.isArray(a.opportunities) ? a.opportunities.length : 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Accounts"
        description="The organisations you brought us. Add their people and their opportunities here."
      >
        <Button asChild>
          <Link href="/portal/customers/new">
            <Plus className="h-4 w-4" /> New account
          </Link>
        </Button>
      </PageHeader>

      {created && (
        <div className="mb-5">
          <Alert tone="success">
            Account <strong>{created}</strong> created. Your partner manager has it and will be in
            touch.
          </Alert>
        </div>
      )}

      {contested.length > 0 && (
        <div className="mb-5">
          <Alert tone="warning">
            <span className="font-medium">
              {contested.length === 1
                ? "One of your accounts is contested."
                : `${contested.length} of your accounts are contested.`}
            </span>{" "}
            It matched an organisation we already knew. We are looking into who holds the
            relationship and will come back to you.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Accounts" value={String(accounts.length)} />
        <StatTile label="Opportunities" value={String(totalDeals)} tone="info" />
        <StatTile
          label="Contested"
          value={String(contested.length)}
          tone={contested.length ? "warning" : "neutral"}
        />
      </div>

      <Card className="mt-6">
        {accounts.length === 0 ? (
          <div className="py-10">
            <EmptyState
              title="No accounts yet"
              description="When you win a customer, add them here. We create the account and their first contact, and credit you as the partner who brought them."
              action={
                <Button asChild>
                  <Link href="/portal/customers/new">
                    <Plus className="h-4 w-4" /> Add your first account
                  </Link>
                </Button>
              }
            />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Account</TH>
                <TH>Type</TH>
                <TH priority="tertiary">Industry</TH>
                <TH className="text-right" priority="secondary">Contacts</TH>
                <TH className="text-right" priority="secondary">Opportunities</TH>
                <TH priority="tertiary">Added</TH>
              </TR>
            </THead>
            <TBody>
              {accounts.map((account) => {
                const contacts = Array.isArray(account.contacts) ? account.contacts : [];
                const deals = Array.isArray(account.opportunities) ? account.opportunities : [];

                return (
                  <TR key={account.id}>
                    <TD>
                      <Link
                        href={`/portal/customers/${account.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {account.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {account.accountNumber}
                        {account.registrationContested && (
                          <Badge tone="warning" className="ml-2">
                            <AlertTriangle className="mr-1 inline h-3 w-3" />
                            Contested
                          </Badge>
                        )}
                      </p>
                    </TD>
                    <TD>
                      <Badge tone="neutral">{humanize(account.accountType)}</Badge>
                    </TD>
                    <TD className="text-sm">{account.industry ?? "—"}</TD>
                    <TD className="text-right tabular">{contacts.length}</TD>
                    <TD className="text-right tabular">{deals.length}</TD>
                    <TD className="whitespace-nowrap text-sm">{formatDate(account.createdAt)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
