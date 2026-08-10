import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Alert, Button, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, humanize, daysBetween } from "@/lib/utils";

export default async function ContractsPage() {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="contracts" />;
  const contracts = await prisma.contract.findMany({
    where: { deletedAt: null },
    include: {
      account: { select: { id: true, name: true } },
      owner: { select: { fullName: true } },
      opportunity: { select: { id: true, name: true } },
      _count: { select: { projects: true, invoices: true } },
    },
    orderBy: { endDate: "asc" },
  });

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
                <TH>Customer</TH>
                <TH>Type</TH>
                <TH>Owner</TH>
                <TH>Term</TH>
                <TH className="text-right">Value</TH>
                <TH>Billing</TH>
                <TH>Renewal</TH>
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
                    <TD className="text-sm">
                      <Link href={`/accounts/${c.account.id}`} className="hover:underline">
                        {c.account.name}
                      </Link>
                    </TD>
                    <TD className="text-sm text-muted-foreground">{c.contractType}</TD>
                    <TD className="text-sm text-muted-foreground">{c.owner.fullName}</TD>
                    <TD className={`text-sm ${soon ? "text-amber-600 dark:text-amber-400" : ""}`}>
                      {formatDate(c.startDate)} → {formatDate(c.endDate)}
                      {soon && <p className="text-xs">{days} days left</p>}
                    </TD>
                    <TD className="text-right font-medium tabular">
                      {formatMoney(c.contractValue, c.currencyCode)}
                    </TD>
                    <TD className="text-sm text-muted-foreground">
                      {c.billingFrequency ? humanize(c.billingFrequency) : "—"}
                    </TD>
                    <TD className="text-sm text-muted-foreground">
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
