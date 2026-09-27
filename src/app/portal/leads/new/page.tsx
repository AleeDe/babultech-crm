import { getPartnerLeadPicklists } from "@/server/partner-leads";
import { PageHeader } from "@/components/ui";
import { PartnerLeadForm } from "../lead-form";

export default async function NewPortalLeadPage() {
  const picklists = await getPartnerLeadPicklists();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo="/portal/leads"
        backLabel="Back to leads"
        title="New lead"
        description="Somebody you are talking to about a sale. It is yours, and your partner manager can see it too."
      />
      <PartnerLeadForm picklists={picklists} />
    </div>
  );
}
