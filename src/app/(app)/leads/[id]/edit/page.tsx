import Link from "next/link";
import { notFound } from "next/navigation";
import { getLead, getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Alert, Button , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { LeadForm, type LeadDefaults } from "../../lead-form";

export default async function EditLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="leads" />;
  const [lead, options] = await Promise.all([getLead(id), getFormOptions()]);
  if (!lead) notFound();

  // Spec §13: conversion freezes the lead. Show where it went instead of a form.
  if (lead.status === "CONVERTED") {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
        backTo={`/leads/${id}`}
        backLabel="Back to the lead"
        title={`${lead.firstName} ${lead.lastName}`} description={lead.leadNumber} />
        <Alert tone="info">
          This lead was converted on {lead.convertedAt?.toLocaleDateString("en-GB")} and is now
          read-only. Edit the records it became instead.
        </Alert>
        <div className="mt-4 flex gap-2">
          {lead.convertedAccount && (
            <Button asChild variant="outline">
              <Link href={`/accounts/${lead.convertedAccount.id}`}>{lead.convertedAccount.name}</Link>
            </Button>
          )}
          {lead.convertedOpportunity && (
            <Button asChild variant="outline">
              <Link href={`/opportunities/${lead.convertedOpportunity.id}`}>
                {lead.convertedOpportunity.name}
              </Link>
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/leads">Back to leads</Link>
          </Button>
        </div>
      </div>
    );
  }

  const defaults = serialize({
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    companyName: lead.companyName,
    jobTitle: lead.jobTitle,
    email: lead.email,
    phone: lead.phone,
    whatsapp: lead.whatsapp,
    industry: lead.industry,
    website: lead.website,
    businessType: lead.businessType,
    companySize: lead.companySize,
    street: lead.street,
    city: lead.city,
    state: lead.state,
    postalCode: lead.postalCode,
    country: lead.country,
    leadSource: lead.leadSource,
    campaignId: lead.campaignId,
    referredByPartnerId: lead.referredByPartnerId,
    ownerUserId: lead.ownerUserId,
    status: lead.status,
    rating: lead.rating,
    estimatedValue: lead.estimatedValue,
    description: lead.description,
    nextFollowUpAt: lead.nextFollowUpAt,
    disqualifiedReason: lead.disqualifiedReason,
  }) as unknown as LeadDefaults;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo={`/leads/${id}`}
        backLabel="Back to the lead"
        title={`${lead.firstName} ${lead.lastName}`}
        description={lead.leadNumber}
      >
        <Button asChild variant="secondary">
          <Link href={`/leads/${lead.id}/convert`}>Convert…</Link>
        </Button>
      </PageHeader>
      <LeadForm
        options={serialize({
          users: options.users,
          campaigns: options.campaigns,
          partners: options.partners,
        })}
        defaults={defaults}
        currentUserId={user.id}
      />
    </div>
  );
}
