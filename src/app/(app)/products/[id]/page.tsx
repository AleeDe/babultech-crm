import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, DetailRow, Forbidden
} from "@/components/ui";
import { formatMoney, formatPercent, formatDate, formatNumber, humanize } from "@/lib/utils";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="the product catalogue" />;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      defaultTaxRate: true,
      opportunityLines: {
        include: {
          opportunity: {
            select: {
              id: true, opportunityNumber: true, name: true, stage: true, currencyCode: true,
              account: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 25,
      },
      quoteLines: {
        include: {
          quotation: {
            select: {
              id: true, quoteNumber: true, status: true, currencyCode: true,
              account: { select: { id: true, name: true } },
            },
          },
        },
        take: 25,
      },
      invoiceLines: {
        include: {
          invoice: {
            select: {
              id: true, invoiceNumber: true, status: true, invoiceDate: true, currencyCode: true,
              account: { select: { id: true, name: true } },
            },
          },
        },
        take: 25,
      },
    },
  });

  if (!product) notFound();

  const price = Number(product.standardPrice ?? 0);
  const cost = Number(product.standardCost ?? 0);
  const marginPercent = price > 0 ? ((price - cost) / price) * 100 : 0;

  const pipelineValue = product.opportunityLines
    .filter((l) => !["CLOSED_WON", "CLOSED_LOST"].includes(l.opportunity.stage))
    .reduce((s, l) => s + Number(l.lineTotal), 0);
  const invoicedValue = product.invoiceLines.reduce((s, l) => s + Number(l.lineTotal), 0);

  return (
    <>
      <PageHeader title={product.name} description={`${product.productCode} · ${humanize(product.productType)}`}>
        <Badge tone={product.active ? "success" : "neutral"}>{product.active ? "Active" : "Inactive"}</Badge>
        {!product.commissionable && <Badge tone="warning">Not commissionable</Badge>}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="List price" value={formatMoney(product.standardPrice)} sublabel={product.unitOfMeasure ? `per ${product.unitOfMeasure}` : undefined} />
        <StatTile
          label="Margin"
          value={price > 0 ? formatPercent(marginPercent, 1) : "—"}
          sublabel={`Cost ${formatMoney(product.standardCost)}`}
          tone={marginPercent >= 30 ? "success" : marginPercent > 0 ? "warning" : "neutral"}
        />
        <StatTile label="In open pipeline" value={formatMoney(pipelineValue)} sublabel={`${product.opportunityLines.length} deal line(s)`} tone="info" />
        <StatTile label="Invoiced" value={formatMoney(invoicedValue)} sublabel={`${product.invoiceLines.length} invoice line(s)`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>On opportunities</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {product.opportunityLines.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">Not on any deal yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Deal</TH>
                      <TH>Customer</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Line total</TH>
                      <TH>Stage</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {product.opportunityLines.map((l) => (
                      <TR key={l.id}>
                        <TD>
                          <Link href={`/opportunities/${l.opportunity.id}`} className="font-medium hover:underline">
                            {l.opportunity.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{l.opportunity.opportunityNumber}</p>
                        </TD>
                        <TD className="text-sm">
                          <Link href={`/accounts/${l.opportunity.account.id}`} className="hover:underline">
                            {l.opportunity.account.name}
                          </Link>
                        </TD>
                        <TD className="text-right tabular">{formatNumber(l.quantity, 2)}</TD>
                        <TD className="text-right tabular">{formatMoney(l.lineTotal, l.opportunity.currencyCode)}</TD>
                        <TD><Badge tone={statusTone(l.opportunity.stage)}>{humanize(l.opportunity.stage)}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>On quotes and invoices</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {product.quoteLines.length === 0 && product.invoiceLines.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">Never quoted or invoiced.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Document</TH>
                      <TH>Customer</TH>
                      <TH className="text-right">Line total</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {product.quoteLines.map((l) => (
                      <TR key={l.id}>
                        <TD>
                          <Link href={`/quotations/${l.quotation.id}`} className="font-medium hover:underline">
                            {l.quotation.quoteNumber}
                          </Link>
                          <p className="text-xs text-muted-foreground">Quotation</p>
                        </TD>
                        <TD className="text-sm">
                          <Link href={`/accounts/${l.quotation.account.id}`} className="hover:underline">
                            {l.quotation.account.name}
                          </Link>
                        </TD>
                        <TD className="text-right tabular">{formatMoney(l.lineTotal, l.quotation.currencyCode)}</TD>
                        <TD><Badge tone={statusTone(l.quotation.status)}>{humanize(l.quotation.status)}</Badge></TD>
                      </TR>
                    ))}
                    {product.invoiceLines.map((l) => (
                      <TR key={l.id}>
                        <TD>
                          <Link href={`/invoices/${l.invoice.id}`} className="font-medium hover:underline">
                            {l.invoice.invoiceNumber}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            Invoice · {formatDate(l.invoice.invoiceDate)}
                          </p>
                        </TD>
                        <TD className="text-sm">
                          <Link href={`/accounts/${l.invoice.account.id}`} className="hover:underline">
                            {l.invoice.account.name}
                          </Link>
                        </TD>
                        <TD className="text-right tabular">{formatMoney(l.lineTotal, l.invoice.currencyCode)}</TD>
                        <TD><Badge tone={statusTone(l.invoice.status)}>{humanize(l.invoice.status)}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Code">{product.productCode}</DetailRow>
              <DetailRow label="Category">{product.category ?? "—"}</DetailRow>
              <DetailRow label="Type">{humanize(product.productType)}</DetailRow>
              <DetailRow label="Billing">{humanize(product.billingType)}</DetailRow>
              <DetailRow label="Unit of measure">{product.unitOfMeasure ?? "—"}</DetailRow>
              <DetailRow label="Default tax">
                {product.defaultTaxRate
                  ? `${product.defaultTaxRate.name} (${formatPercent(product.defaultTaxRate.ratePercent, 1)})`
                  : "None"}
              </DetailRow>
              <DetailRow label="Commission">
                {product.commissionable
                  ? product.commissionPercent
                    ? `${formatPercent(product.commissionPercent, 2)} override`
                    : "Uses the partner's plan"
                  : "Excluded from commission"}
              </DetailRow>
            </CardContent>
          </Card>

          {product.description && (
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{product.description}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
