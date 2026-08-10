import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, DetailRow, Alert, Button,
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize, daysBetween } from "@/lib/utils";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, accountNumber: true } },
      owner: { select: { id: true, fullName: true } },
      opportunity: { select: { id: true, opportunityNumber: true, name: true } },
      quotation: { select: { id: true, quoteNumber: true, versionNumber: true } },
      projects: {
        select: {
          id: true, projectNumber: true, name: true, status: true, health: true,
          completionPercent: true,
        },
      },
      cases: {
        select: { id: true, caseNumber: true, subject: true, status: true, priority: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      invoices: {
        select: {
          id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, status: true,
          totalAmount: true, outstandingAmount: true, currencyCode: true,
        },
        orderBy: { invoiceDate: "desc" },
      },
    },
  });

  if (!contract) notFound();

  const daysToEnd = daysBetween(new Date(), contract.endDate);
  const invoiced = contract.invoices
    .filter((i) => !["DRAFT", "CANCELLED"].includes(i.status))
    .reduce((s, i) => s + Number(i.totalAmount), 0);
  const outstanding = contract.invoices.reduce((s, i) => s + Number(i.outstandingAmount), 0);
  const invoicedPercent =
    Number(contract.contractValue) > 0 ? (invoiced / Number(contract.contractValue)) * 100 : 0;

  const inRenewalWindow =
    contract.status === "ACTIVE" && daysToEnd <= (contract.noticePeriodDays ?? 90) && daysToEnd >= 0;

  return (
    <>
      <PageHeader
        title={contract.name}
        description={`${contract.contractNumber} · ${contract.account.name}`}
      >
        <Badge tone={statusTone(contract.status)}>{humanize(contract.status)}</Badge>
        <Button asChild variant="outline">
          <Link href={`/contracts/${contract.id}/edit`}>Edit</Link>
        </Button>
        <Button asChild>
          <Link href={`/invoices/new?accountId=${contract.account.id}`}>New invoice</Link>
        </Button>
      </PageHeader>

      {inRenewalWindow && (
        <div className="mb-5">
          <Alert tone="warning">
            Ends in {daysToEnd} day(s)
            {contract.noticePeriodDays && ` and the notice period is ${contract.noticePeriodDays} days`}
            {contract.renewalType && ` · renewal is ${humanize(contract.renewalType).toLowerCase()}`}.
            Start the renewal conversation now.
          </Alert>
        </div>
      )}
      {daysToEnd < 0 && contract.status === "ACTIVE" && (
        <div className="mb-5">
          <Alert tone="danger">
            This contract expired {Math.abs(daysToEnd)} day(s) ago but is still marked Active.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Contract value" value={formatMoney(contract.contractValue, contract.currencyCode)} />
        <StatTile
          label="Invoiced"
          value={formatMoney(invoiced, contract.currencyCode)}
          sublabel={`${formatPercent(invoicedPercent, 0)} of value`}
          tone="info"
        />
        <StatTile
          label="Outstanding"
          value={formatMoney(outstanding, contract.currencyCode)}
          tone={outstanding > 0 ? "warning" : "success"}
        />
        <StatTile
          label="Term"
          value={formatDate(contract.endDate)}
          sublabel={`from ${formatDate(contract.startDate)}`}
          tone={daysToEnd < 0 ? "danger" : inRenewalWindow ? "warning" : "neutral"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {contract.invoices.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">Nothing invoiced against this contract.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Invoice</TH>
                      <TH>Due</TH>
                      <TH className="text-right">Total</TH>
                      <TH className="text-right">Outstanding</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {contract.invoices.map((i) => (
                      <TR key={i.id}>
                        <TD>
                          <Link href={`/invoices/${i.id}`} className="font-medium hover:underline">
                            {i.invoiceNumber}
                          </Link>
                          <p className="text-xs text-muted-foreground">{formatDate(i.invoiceDate)}</p>
                        </TD>
                        <TD className="text-sm">{formatDate(i.dueDate)}</TD>
                        <TD className="text-right tabular">{formatMoney(i.totalAmount, i.currencyCode)}</TD>
                        <TD className="text-right tabular">{formatMoney(i.outstandingAmount, i.currencyCode)}</TD>
                        <TD><Badge tone={statusTone(i.status)}>{humanize(i.status)}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Delivery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Projects</p>
                {contract.projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects under this contract.</p>
                ) : (
                  <div className="space-y-2">
                    {contract.projects.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div className="min-w-0">
                          <Link href={`/projects/${p.id}`} className="text-sm font-medium hover:underline">
                            {p.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {p.projectNumber} · {formatPercent(p.completionPercent, 0)} complete
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge tone={statusTone(p.health)}>{humanize(p.health)}</Badge>
                          <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Support cases</p>
                {contract.cases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No cases raised under this contract.</p>
                ) : (
                  <div className="space-y-2">
                    {contract.cases.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <Link href={`/cases/${c.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                          {c.subject}
                          <span className="block text-xs text-muted-foreground">{c.caseNumber}</span>
                        </Link>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge tone={statusTone(c.priority)}>{humanize(c.priority)}</Badge>
                          <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Customer">
                <Link href={`/accounts/${contract.account.id}`} className="text-primary hover:underline">
                  {contract.account.name}
                </Link>
                <p className="text-xs text-muted-foreground">{contract.account.accountNumber}</p>
              </DetailRow>
              <DetailRow label="Owner">{contract.owner.fullName}</DetailRow>
              <DetailRow label="Contract type">{contract.contractType}</DetailRow>
              <DetailRow label="Sourced from">
                {contract.opportunity ? (
                  <Link href={`/opportunities/${contract.opportunity.id}`} className="text-primary hover:underline">
                    {contract.opportunity.opportunityNumber} — {contract.opportunity.name}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="From quote">
                {contract.quotation ? (
                  <Link href={`/quotations/${contract.quotation.id}`} className="text-primary hover:underline">
                    {contract.quotation.quoteNumber} (v{contract.quotation.versionNumber})
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Billing frequency">{humanize(contract.billingFrequency)}</DetailRow>
              <DetailRow label="Renewal">{humanize(contract.renewalType)}</DetailRow>
              <DetailRow label="Notice period">
                {contract.noticePeriodDays ? `${contract.noticePeriodDays} days` : "—"}
              </DetailRow>
              <DetailRow label="Signed">{formatDate(contract.signedDate)}</DetailRow>
              {contract.terminationReason && (
                <DetailRow label="Terminated because">{contract.terminationReason}</DetailRow>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
