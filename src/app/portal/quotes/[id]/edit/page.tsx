import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartnerQuote, getPartnerQuoteFormContext } from "@/server/partner-quotes";
import { PageHeader, Alert, Button } from "@/components/ui";
import { humanize, serialize } from "@/lib/utils";
import type { QuoteDefaults } from "@/components/quote-editor";
import { PartnerQuoteForm } from "../../quote-form";

/**
 * Changing one of the partner's quotes: a draft, or an approved quote that has
 * not gone out - which then needs approving again.
 */
export default async function PortalEditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quote = await getPartnerQuote(id);
  if (!quote) notFound();

  const dealClosed = ["CLOSED_WON", "CLOSED_LOST"].includes(quote.opportunity?.stage ?? "");
  const context = await getPartnerQuoteFormContext(quote.opportunityId);
  if (!context) notFound();

  const header = (
    <PageHeader
      backTo={`/portal/quotes/${id}`}
      backLabel="Back to the quote"
      title={`Edit ${quote.quoteNumber}`}
      description={`Version ${quote.versionNumber} · ${humanize(quote.status)}`}
    />
  );

  if (dealClosed || !["DRAFT", "APPROVED"].includes(quote.status)) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <Alert tone="info">
          {dealClosed
            ? "The deal is closed, so its quotes stay as they are."
            : quote.status === "UNDER_REVIEW"
              ? "This quote is waiting for your partner manager's approval. Withdraw the request on the quote to change it."
              : `This quote is ${humanize(quote.status).toLowerCase()} and the customer has seen it, so it stays as it was sent. Create a revision instead.`}
        </Alert>
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href={`/portal/quotes/${id}`}>Back to the quote</Link>
          </Button>
        </div>
      </div>
    );
  }

  const defaults: QuoteDefaults = serialize({
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    opportunityId: quote.opportunityId,
    contactId: quote.contactId,
    quoteDate: quote.quoteDate,
    expiryDate: quote.expiryDate,
    currencyCode: quote.currencyCode,
    priceBookId: quote.priceBookId,
    paymentTerms: quote.paymentTerms,
    notes: quote.notes,
    termsAndConditions: quote.termsAndConditions,
    lines: quote.lines.map((l) => ({
      productId: l.productId,
      priceBookEntryId: l.priceBookEntryId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      licenseCost: l.licenseCost,
      maintenanceCost: l.maintenanceCost,
      cloudCost: l.cloudCost,
      aiCost: l.aiCost,
      discountPercent: l.discountPercent,
      taxRateId: l.taxRateId,
    })),
  });

  return (
    <div className="mx-auto max-w-5xl">
      {header}
      {quote.status === "APPROVED" && (
        <div className="mb-5">
          <Alert tone="warning">
            This quote is approved. Saving a change takes it back to a draft that needs your partner
            manager&apos;s approval again.
          </Alert>
        </div>
      )}
      <PartnerQuoteForm context={serialize(context)} defaults={defaults} />
    </div>
  );
}
