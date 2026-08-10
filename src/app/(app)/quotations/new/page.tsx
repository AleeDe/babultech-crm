import { getQuotationFormOptions } from "@/server/quotations";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { QuoteForm, type QuoteFormOptions } from "../quote-form";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ opportunityId?: string }>;
}) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_WRITE);
  const [{ opportunityId }, options] = await Promise.all([
    searchParams,
    getQuotationFormOptions(),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="New quote"
        description="Saved as a draft. Sending it locks the numbers — after that you revise rather than edit."
      />
      <QuoteForm
        options={serialize(options) as unknown as QuoteFormOptions}
        lockedOpportunityId={opportunityId}
      />
    </div>
  );
}
