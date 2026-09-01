import { getQuotationFormOptions } from "@/server/quotations";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { QuoteForm, type QuoteFormOptions } from "../quote-form";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ opportunityId?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="quotations" />;
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
        options={serialize(options)}
        lockedOpportunityId={opportunityId}
      />
    </div>
  );
}
