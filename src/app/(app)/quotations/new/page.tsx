import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuoteFormContext } from "@/server/quotations";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Alert, Button } from "@/components/ui";
import { serialize, humanize } from "@/lib/utils";
import { QuoteForm } from "../quote-form";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ opportunityId?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="quotations" />;
  const { opportunityId } = await searchParams;
  const context = await getQuoteFormContext(opportunityId ?? null);
  if (opportunityId && !context.opportunity) notFound();

  const closed = context.opportunity && ["CLOSED_WON", "CLOSED_LOST"].includes(context.opportunity.stage);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        backTo={context.opportunity ? `/opportunities/${context.opportunity.id}` : "/quotations"}
        backLabel={context.opportunity ? "Back to the deal" : "Back to quotations"}
        title="New quote"
        description="Saved as a draft. Sending it locks the numbers - after that you revise rather than edit."
      />
      {closed ? (
        <>
          <Alert tone="info">
            This deal is {humanize(context.opportunity!.stage).toLowerCase()}, so there is nothing
            left to quote on it. Reopen it first if the customer is back.
          </Alert>
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link href={`/opportunities/${context.opportunity!.id}`}>Back to the deal</Link>
            </Button>
          </div>
        </>
      ) : (
        <QuoteForm context={serialize(context)} />
      )}
    </div>
  );
}
