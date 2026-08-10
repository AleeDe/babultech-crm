import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, DetailRow, Alert,
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, formatNumber, humanize } from "@/lib/utils";

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  const quote = await prisma.quotation.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, accountNumber: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      opportunity: {
        select: {
          id: true, opportunityNumber: true, name: true, stage: true,
          owner: { select: { id: true, fullName: true } },
        },
      },
      lines: {
        include: {
          product: { select: { id: true, name: true, productCode: true } },
          taxRate: { select: { id: true, name: true, ratePercent: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
      contracts: { select: { id: true, contractNumber: true, name: true, status: true } },
    },
  });

  if (!quote) notFound();

  const expired = quote.expiryDate < new Date() && !["ACCEPTED", "REJECTED"].includes(quote.status);

  // Other versions of the same quote — a quote is versioned per opportunity.
  const versions = await prisma.quotation.findMany({
    where: { opportunityId: quote.opportunityId, deletedAt: null },
    select: { id: true, quoteNumber: true, versionNumber: true, status: true, totalAmount: true },
    orderBy: { versionNumber: "desc" },
  });

  return (
    <>
      <PageHeader
        title={`${quote.quoteNumber} — v${quote.versionNumber}`}
        description={`${quote.account.name} · ${quote.opportunity.name}`}
      >
        <Badge tone={statusTone(quote.status)}>{humanize(quote.status)}</Badge>
        {quote.approvalStatus !== "NOT_REQUIRED" && (
          <Badge tone={statusTone(quote.approvalStatus)}>{humanize(quote.approvalStatus)}</Badge>
        )}
      </PageHeader>

      {expired && (
        <div className="mb-5">
          <Alert tone="warning">
            This quote expired on {formatDate(quote.expiryDate)}. Issue a new version rather than
            editing it — the customer was sent these numbers.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total" value={formatMoney(quote.totalAmount, quote.currencyCode)} />
        <StatTile label="Subtotal" value={formatMoney(quote.subtotal, quote.currencyCode)} sublabel={`Discount ${formatMoney(quote.discountAmount, quote.currencyCode)}`} />
        <StatTile label="Tax" value={formatMoney(quote.taxAmount, quote.currencyCode)} />
        <StatTile
          label="Valid until"
          value={formatDate(quote.expiryDate)}
          tone={expired ? "danger" : "neutral"}
          sublabel={quote.acceptedAt ? `Accepted ${formatDate(quote.acceptedAt)}` : quote.sentAt ? `Sent ${formatDate(quote.sentAt)}` : "Not sent"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Lines</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {quote.lines.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">This quote has no lines.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Description</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Unit price</TH>
                      <TH className="text-right">Discount</TH>
                      <TH>Tax</TH>
                      <TH className="text-right">Total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {quote.lines.map((l) => (
                      <TR key={l.id}>
                        <TD className="text-sm">
                          {l.product ? (
                            <Link href={`/products/${l.product.id}`} className="font-medium hover:underline">
                              {l.product.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{l.description}</span>
                          )}
                          {l.product && <p className="text-xs text-muted-foreground">{l.description}</p>}
                        </TD>
                        <TD className="text-right tabular">{formatNumber(l.quantity, 2)}</TD>
                        <TD className="text-right tabular">{formatMoney(l.unitPrice, quote.currencyCode)}</TD>
                        <TD className="text-right tabular">{formatPercent(l.discountPercent)}</TD>
                        <TD className="text-sm text-muted-foreground">{l.taxRate?.name ?? "—"}</TD>
                        <TD className="text-right font-medium tabular">{formatMoney(l.lineTotal, quote.currencyCode)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {(quote.paymentTerms || quote.termsAndConditions || quote.notes) && (
            <Card>
              <CardHeader>
                <CardTitle>Terms</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {quote.paymentTerms && <DetailRow label="Payment terms"><p className="whitespace-pre-wrap">{quote.paymentTerms}</p></DetailRow>}
                {quote.termsAndConditions && <DetailRow label="Terms and conditions"><p className="whitespace-pre-wrap">{quote.termsAndConditions}</p></DetailRow>}
                {quote.notes && <DetailRow label="Notes"><p className="whitespace-pre-wrap">{quote.notes}</p></DetailRow>}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Customer">
                <Link href={`/accounts/${quote.account.id}`} className="text-primary hover:underline">
                  {quote.account.name}
                </Link>
                <p className="text-xs text-muted-foreground">{quote.account.accountNumber}</p>
              </DetailRow>
              <DetailRow label="Opportunity">
                <Link href={`/opportunities/${quote.opportunity.id}`} className="text-primary hover:underline">
                  {quote.opportunity.opportunityNumber} — {quote.opportunity.name}
                </Link>
              </DetailRow>
              <DetailRow label="Contact">
                {quote.contact ? (
                  <Link href={`/contacts/${quote.contact.id}/edit`} className="text-primary hover:underline">
                    {quote.contact.firstName} {quote.contact.lastName}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Deal owner">{quote.opportunity.owner.fullName}</DetailRow>
              <DetailRow label="Quote date">{formatDate(quote.quoteDate)}</DetailRow>
              <DetailRow label="Currency">{quote.currencyCode}</DetailRow>
            </CardContent>
          </Card>

          {versions.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Versions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0">
                    <Link
                      href={`/quotations/${v.id}`}
                      className={v.id === quote.id ? "font-semibold" : "text-primary hover:underline"}
                    >
                      v{v.versionNumber} — {v.quoteNumber}
                    </Link>
                    <div className="text-right">
                      <p className="tabular text-xs">{formatMoney(v.totalAmount, quote.currencyCode)}</p>
                      <Badge tone={statusTone(v.status)}>{humanize(v.status)}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {quote.contracts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Contracts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {quote.contracts.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <Link href={`/contracts/${c.id}`} className="text-primary hover:underline">
                      {c.contractNumber}
                    </Link>
                    <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
