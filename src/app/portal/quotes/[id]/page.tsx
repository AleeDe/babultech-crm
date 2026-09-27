import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { getPartnerQuote, listPartnerQuoteEmails, emailPartnerQuote } from "@/server/partner-quotes";
import { isEmailConfigured } from "@/server/email";
import { partnerQuoteEmailBlock } from "@/lib/partner-quote-rules";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, DetailRow, Alert, Button,
} from "@/components/ui";
import { SendEmailPanel } from "@/components/send-email-panel";
import { formatMoney, formatDate, formatPercent, formatNumber, humanize } from "@/lib/utils";
import { PartnerQuoteActions } from "./quote-actions";

/** A line's four costs together, as the deal's lines show them. */
const costsOf = (l: { licenseCost: string; maintenanceCost: string; cloudCost: string; aiCost: string }) =>
  Number(l.licenseCost ?? 0) + Number(l.maintenanceCost ?? 0) + Number(l.cloudCost ?? 0) + Number(l.aiCost ?? 0);

/**
 * One of the partner's quotes: what it offers, where it stands - approval,
 * sending, the customer's answer - and what has been emailed about it.
 */
export default async function PortalQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [quote, emails, emailConfigured] = await Promise.all([
    getPartnerQuote(id),
    listPartnerQuoteEmails(id),
    isEmailConfigured(),
  ]);
  if (!quote) notFound();

  const dealClosed = ["CLOSED_WON", "CLOSED_LOST"].includes(quote.opportunity?.stage ?? "");
  const editable = !dealClosed && ["DRAFT", "APPROVED"].includes(quote.status);
  const today = new Date().toISOString().slice(0, 10);
  const expired = quote.expiryDate.slice(0, 10) < today && !["ACCEPTED", "REJECTED", "REVISED"].includes(quote.status);
  const emailBlock = dealClosed
    ? "The deal is closed, so this quote is not emailed from here."
    : partnerQuoteEmailBlock(quote);
  const waiting = quote.status === "UNDER_REVIEW";

  // Bound here rather than passed through the client, where the id could be
  // rewritten to send somebody else's quote.
  const sendHere = emailPartnerQuote.bind(null, id);

  return (
    <>
      <PageHeader
        backTo={`/portal/deals/${quote.opportunityId}`}
        backLabel="Back to the deal"
        title={`${quote.quoteNumber} - v${quote.versionNumber}`}
        description={`${quote.account?.name ?? ""}${quote.opportunity ? ` · ${quote.opportunity.name}` : ""}`}
      >
        <Badge tone={statusTone(waiting ? "PENDING" : quote.status)}>
          {waiting ? "Waiting for approval" : humanize(quote.status)}
        </Badge>
        {editable && (
          <Button asChild variant="outline">
            <Link href={`/portal/quotes/${quote.id}/edit`}>
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </Button>
        )}
      </PageHeader>

      {expired && (
        <div className="mb-5">
          <Alert tone="warning">
            This quote&apos;s valid-until date, {formatDate(quote.expiryDate)}, has passed.
            {["DRAFT", "APPROVED"].includes(quote.status)
              ? " Change its dates before it goes to the customer."
              : " Create a revision with new dates to quote again."}
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total" value={formatMoney(quote.totalAmount, quote.currencyCode)} />
        <StatTile
          label="Subtotal"
          value={formatMoney(quote.subtotal, quote.currencyCode)}
          sublabel={`Discount ${formatMoney(quote.discountAmount, quote.currencyCode)}`}
        />
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
              <CardTitle>Products and services</CardTitle>
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
                      <TH className="text-right" priority="secondary">Unit price</TH>
                      <TH className="text-right" priority="tertiary">Costs</TH>
                      <TH className="text-right" priority="secondary">Discount</TH>
                      <TH className="text-right" priority="tertiary">Tax</TH>
                      <TH className="text-right">Total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {quote.lines.map((l) => (
                      <TR key={l.id}>
                        <TD className="text-sm">
                          <span className="font-medium">{l.product?.name ?? l.description}</span>
                          {l.product && l.description !== l.product.name && (
                            <p className="text-xs text-muted-foreground">{l.description}</p>
                          )}
                        </TD>
                        <TD className="text-right tabular">{formatNumber(l.quantity, 2)}</TD>
                        <TD className="text-right tabular" priority="secondary">{formatMoney(l.unitPrice, quote.currencyCode)}</TD>
                        <TD className="text-right tabular" priority="tertiary">
                          {costsOf(l) > 0 ? formatMoney(costsOf(l), quote.currencyCode) : "—"}
                        </TD>
                        <TD className="text-right tabular" priority="secondary">
                          {Number(l.discountPercent) > 0 ? formatPercent(l.discountPercent) : "—"}
                        </TD>
                        <TD className="text-right text-sm text-muted-foreground" priority="tertiary">
                          {Number(l.taxPercent) > 0 ? formatPercent(l.taxPercent) : "—"}
                        </TD>
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
                {quote.notes && <DetailRow label="Internal notes"><p className="whitespace-pre-wrap">{quote.notes}</p></DetailRow>}
              </CardContent>
            </Card>
          )}

          <SendEmailPanel
            documentLabel="quotation"
            defaultTo={quote.contact?.email ?? null}
            defaultSubject={`Quotation ${quote.quoteNumber} from BabulTech`}
            defaultMessage={`Dear ${quote.contact?.firstName ?? "Sir or Madam"},

Please find our quotation below for your consideration. It is valid until the date shown.

Do let me know if you would like anything adjusted.`}
            configured={emailConfigured}
            emails={emails}
            send={sendHere}
            blockedReason={emailBlock}
            reloadOnSend
          />
        </div>

        <div className="space-y-6">
          <PartnerQuoteActions
            quoteId={quote.id}
            quoteNumber={quote.quoteNumber}
            status={quote.status}
            approvalStatus={quote.approvalStatus}
            approvalNote={quote.approvalNote}
            approvalRequestedAt={quote.approvalRequestedAt}
            approvalDecidedAt={quote.approvalDecidedAt}
            preparedByPartner={Boolean(quote.preparedByPartnerId)}
            expired={expired}
            dealId={quote.opportunityId}
            dealClosed={dealClosed}
          />

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Customer">
                {quote.account ? (
                  <Link href={`/portal/customers/${quote.account.id}`} className="text-primary hover:underline">
                    {quote.account.name}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Opportunity">
                {quote.opportunity ? (
                  <Link href={`/portal/deals/${quote.opportunity.id}`} className="text-primary hover:underline">
                    {quote.opportunity.opportunityNumber} - {quote.opportunity.name}
                  </Link>
                ) : "—"}
              </DetailRow>
              <DetailRow label="Contact">
                {quote.contact ? `${quote.contact.firstName} ${quote.contact.lastName}` : "—"}
              </DetailRow>
              <DetailRow label="Prepared by">
                {quote.preparedByPartnerId ? "You - approved by your partner manager before it is sent" : "BabulTech"}
              </DetailRow>
              <DetailRow label="Quote date">{formatDate(quote.quoteDate)}</DetailRow>
              <DetailRow label="Currency">{quote.currencyCode}</DetailRow>
            </CardContent>
          </Card>

          {quote.versions.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Versions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {quote.versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0">
                    <Link
                      href={`/portal/quotes/${v.id}`}
                      className={v.id === quote.id ? "font-semibold" : "text-primary hover:underline"}
                    >
                      v{v.versionNumber} - {v.quoteNumber}
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
        </div>
      </div>
    </>
  );
}
