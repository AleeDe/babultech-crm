import { notFound, redirect } from "next/navigation";
import { getPartnerLead, getPartnerLeadPicklists } from "@/server/partner-leads";
import { PageHeader } from "@/components/ui";
import { PartnerLeadForm } from "../../lead-form";

export default async function EditPortalLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead, picklists] = await Promise.all([getPartnerLead(id), getPartnerLeadPicklists()]);
  if (!lead) notFound();
  // A converted lead is the record of how a customer arrived, not a draft.
  if (lead.convertedAt) redirect(`/portal/leads/${id}`);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo={`/portal/leads/${id}`}
        backLabel="Back to the lead"
        title={`Edit ${lead.firstName} ${lead.lastName}`}
        description={lead.leadNumber}
      />
      <PartnerLeadForm lead={lead} picklists={picklists} />
    </div>
  );
}
