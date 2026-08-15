import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuotation, getQuotationFormOptions } from "@/server/quotations";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Alert, Button , Forbidden} from "@/components/ui";
import { serialize, humanize } from "@/lib/utils";
import { QuoteForm, type QuoteDefaults, type QuoteFormOptions } from "../../quote-form";

const EDITABLE = ["DRAFT", "UNDER_REVIEW", "APPROVED"];

export default async function EditQuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="quotations" />;
  const [quote, options] = await Promise.all([getQuotation(id), getQuotationFormOptions()]);
  if (!quote) notFound();

  // A quote the customer has seen is a document, not a draft.
  if (!EDITABLE.includes(quote.status)) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={quote.quoteNumber} description={`Version ${quote.versionNumber}`} />
        <Alert tone="info">
          This quote is {humanize(quote.status).toLowerCase()} and has already been put in front of
          the customer, so it cannot be edited. Create a revision instead — the original stays on
          record as what they were actually shown.
        </Alert>
        <div className="mt-4 flex gap-2">
          <Button asChild>
            <Link href={`/quotations/${quote.id}`}>Back to the quote</Link>
          </Button>
        </div>
      </div>
    );
  }

  const defaults = serialize({
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    opportunityId: quote.opportunityId,
    contactId: quote.contactId,
    quoteDate: quote.quoteDate,
    expiryDate: quote.expiryDate,
    currencyCode: quote.currencyCode,
    paymentTerms: quote.paymentTerms,
    notes: quote.notes,
    termsAndConditions: quote.termsAndConditions,
    lines: quote.lines.map((l: Record<string, any>) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRateId: l.taxRateId,
    })),
  }) as unknown as QuoteDefaults;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Edit ${quote.quoteNumber}`}
        description={`Version ${quote.versionNumber} · ${humanize(quote.status)}`}
      />
      <QuoteForm options={serialize(options) as unknown as QuoteFormOptions} defaults={defaults} />
    </div>
  );
}
