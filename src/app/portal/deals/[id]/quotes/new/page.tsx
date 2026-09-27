import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartnerQuoteFormContext } from "@/server/partner-quotes";
import { PageHeader, Alert, Button } from "@/components/ui";
import { humanize, serialize } from "@/lib/utils";
import { PartnerQuoteForm } from "@/app/portal/quotes/quote-form";

/** A new quote for one of the partner's deals, starting from what the deal sells. */
export default async function PortalNewQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getPartnerQuoteFormContext(id);
  if (!context) notFound();

  const closed = ["CLOSED_WON", "CLOSED_LOST"].includes(context.deal.stage);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        backTo={`/portal/deals/${id}`}
        backLabel="Back to the deal"
        title="New quote"
        description="Saved as a draft. Your partner manager approves it before it goes to the customer."
      />
      {closed ? (
        <>
          <Alert tone="info">
            This deal is {humanize(context.deal.stage).toLowerCase()}, so there is nothing left to
            quote on it.
          </Alert>
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link href={`/portal/deals/${id}`}>Back to the deal</Link>
            </Button>
          </div>
        </>
      ) : (
        <PartnerQuoteForm context={serialize(context)} />
      )}
    </div>
  );
}
