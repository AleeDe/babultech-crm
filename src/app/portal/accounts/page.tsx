import { getPortalAccounts } from "@/server/portal";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge,
  EmptyState, StatTile, Alert,
} from "@/components/ui";
import { formatMoney, humanize } from "@/lib/utils";

/**
 * The customers behind a partner's deals. This list is derived from the deals
 * they are attached to — it is not the customer database, and a partner cannot
 * reach a customer they have never worked on.
 */
export default async function PortalAccountsPage() {
  const accounts = await getPortalAccounts();

  const currency = accounts[0]?.currency ?? "PKR";
  const totalValue = accounts.reduce((s, a) => s + Number(a.totalValue), 0);
  const withWins = accounts.filter((a) => a.wonDeals > 0);

  return (
    <>
      <PageHeader
        title="Customers"
        description="The organisations behind the deals you are registered on."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Customers" value={String(accounts.length)} />
        <StatTile label="With a win" value={String(withWins.length)} tone={withWins.length ? "success" : "neutral"} />
        <StatTile label="Total deal value" value={formatMoney(totalValue, currency)} tone="info" />
      </div>

      <Card className="mt-6">
        {accounts.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Once you are registered on a deal, the customer behind it appears here."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Customer</TH>
                <TH>Industry</TH>
                <TH className="text-right">Your deals</TH>
                <TH className="text-right">Won</TH>
                <TH className="text-right">Total value</TH>
              </TR>
            </THead>
            <TBody>
              {accounts.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <span className="text-sm font-medium">{a.name}</span>
                    {a.isOwnRecord && (
                      <Badge tone="info" className="ml-2">Your own organisation</Badge>
                    )}
                  </TD>
                  <TD className="text-sm text-muted-foreground">{a.industry ?? "—"}</TD>
                  <TD className="text-right tabular">{a.deals}</TD>
                  <TD className="text-right tabular">
                    {a.wonDeals > 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400">{a.wonDeals}</span>
                    ) : "—"}
                  </TD>
                  <TD className="text-right font-medium tabular">
                    {formatMoney(a.totalValue, a.currency)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="mt-4">
        <Alert tone="info">
          You see a customer here only because you are registered on one of their deals. Contact
          details and their wider account history stay with our team.
        </Alert>
      </div>
    </>
  );
}
