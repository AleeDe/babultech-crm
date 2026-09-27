import { notFound, redirect } from "next/navigation";
import { getPartnerDeal } from "@/server/partner-deals";
import { getPartnerLeadPicklists } from "@/server/partner-leads";
import { supabaseServer } from "@/lib/supabase";
import { PageHeader } from "@/components/ui";
import { PartnerDealForm } from "./deal-form";

export default async function EditPortalDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, picklists] = await Promise.all([getPartnerDeal(id), getPartnerLeadPicklists()]);
  if (!deal) notFound();
  // What a lost deal was is kept as it was.
  if (deal.stage === "CLOSED_LOST") redirect(`/portal/deals/${id}`);

  const db = await supabaseServer();
  const { data: currencies } = await db.from("currency").select("code, name").eq("active", true).order("code");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        backTo={`/portal/deals/${id}`}
        backLabel="Back to the deal"
        title={`Edit ${deal.name}`}
        description={deal.opportunityNumber}
      />
      <PartnerDealForm
        deal={deal}
        currencies={(currencies ?? []) as { code: string; name: string }[]}
        leadSources={picklists.lead_source}
      />
    </div>
  );
}
