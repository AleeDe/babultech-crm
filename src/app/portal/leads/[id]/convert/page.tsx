import { notFound, redirect } from "next/navigation";
import { getPartnerLead } from "@/server/partner-leads";
import { PageHeader } from "@/components/ui";
import { PartnerConvertForm } from "./convert-form";

export default async function ConvertPortalLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getPartnerLead(id);
  if (!lead) notFound();
  if (lead.convertedAt) redirect(`/portal/leads/${id}`);

  const company = lead.companyName ?? `${lead.firstName} ${lead.lastName}`;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        backTo={`/portal/leads/${id}`}
        backLabel="Back to the lead"
        title={`Convert ${lead.firstName} ${lead.lastName}`}
        description={lead.leadNumber}
      />
      <PartnerConvertForm
        leadId={lead.id}
        company={company}
        suggestedAmount={lead.estimatedValue != null ? String(lead.estimatedValue) : ""}
      />
    </div>
  );
}
