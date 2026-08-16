import Link from "next/link";
import { Plus } from "lucide-react";
import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Alert, Button, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, humanize, daysBetween } from "@/lib/utils";

export default async function ContractsPage() {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="contracts" />;
  const db = await supabaseServer();

  const { data: contractRows } = await db
    .from("contract")
    .select(
      `*,
       account ( id, name ),
       owner:app_user!contract_ownerUserId_fkey ( fullName ),
       opportunity ( id, name ),
       projects:project ( count ),
       invoices:invoice ( count )`,
    )
    .is("deletedAt", null)
    .order("endDate");

  const countOf = (v: unknown) => (v as { count: number }[] | undefined)?.[0]?.count ?? 0;

  const contracts = (contractRows ?? []).map((c) => ({
    ...c,
    account: one(c.account as never),
    owner: one(c.owner as never),
    opportunity: one(c.opportunity as never),
    _count: { projects: countOf(c.projects), invoices: countOf(c.invoices) },
  }));

  const active = contracts.filter((c) => c.status === "ACTIVE");
  const renewalWindow = active.filter((c) => {
    const days = daysBetween(new Date(), c.endDate);
    return days >= 0 && days <= 90;
  });
  const activeValue = active.reduce((s, c) => s + Number(c.contractValue), 0);

  return (
    <>
      <PageHeader
        title="Contracts"
        description="Signed agreements. Renewal notice periods are tracked so nothing auto-renews by accident."
      >
        <Button asChild>
          <Link href="/contracts/new">
            <Plus className="h-4 w-4" /> New contract
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active contracts" value={String(active.length)} />
        <StatTile label="Contracted value" value={formatMoney(activeValue)} tone="success" />
        <StatTile label="Renewing in 90 days" value={String(renewalWindow.length)} tone={renewalWindow.length ? "warning" : "neutral"} />
        <StatTile label="Total on file" value={String(contracts.length)} />
      </div>

      {renewalWindow.length > 0 && (
        <div className="mt-6">
          <Alert tone="warning">
            {renewalWindow.length} contract{renewalWindow.length === 1 ? "" : "s"} reach their end date within
            90 days. Check the notice period before it lapses or auto-renews.
          </Alert>
        </div>
      )}

      <Card className="mt-6">
        {contracts.length === 0 ? (
          <EmptyState title="No contracts yet" description="Contracts follow a won opportunity and its accepted quotation." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Contract</TH>
                <TH priority="secondary">Customer</TH>
                <TH priority="tertiary">Type</TH>
                <TH priority="tertiary">Owner</TH>
                <TH priority="tertiary">Term</TH>
                <TH className="text-right" priority="secondary">Value</TH>
                <TH priority="tertiary">Billing</TH>
                <TH priority="tertiary">Renewal</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {contracts.map((c) => {
                const days = daysBetween(new Date(), c.endDate);
                const soon = c.status === "ACTIVE" && days >= 0 && days <= 90;
                return (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/contracts/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{c.contractNumber}</p>
                    </TD>
                    <TD priority="secondary" className="text-sm">
                      <Link href={`/accounts/${c.account?.id}`} className="hover:underline">
                        {c.account?.name}
                      </Link>
                    </TD>
                    <TD priority="tertiary" className="text-sm text-muted-foreground">{c.contractType}</TD>
                    <TD priority="tertiary" className="text-sm text-muted-foreground">{c.owner?.fullName}</TD>
                    <TD priority="tertiary" className={`text-sm ${soon ? "text-amber-600 dark:text-amber-400" : ""}`}>
                      {formatDate(c.startDate)} → {formatDate(c.endDate)}
                      {soon && <p className="text-xs">{days} days left</p>}
                    </TD>
                    <TD priority="secondary" className="text-right font-medium tabular">
                      {formatMoney(c.contractValue, c.currencyCode)}
                    </TD>
                    <TD priority="tertiary" className="text-sm text-muted-foreground">
                      {c.billingFrequency ? humanize(c.billingFrequency) : "—"}
                    </TD>
                    <TD priority="tertiary" className="text-sm text-muted-foreground">
                      {c.renewalType ? humanize(c.renewalType) : "—"}
                      {c.noticePeriodDays && <p className="text-xs">{c.noticePeriodDays}d notice</p>}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
                    </TD>
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
