import { notFound, redirect } from "next/navigation";
import { getLead, getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ConvertForm } from "./convert-form";

export default async function ConvertLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="leads" />;
  const [lead, options] = await Promise.all([getLead(id), getFormOptions()]);
  if (!lead) notFound();

  if (lead.status === "CONVERTED") {
    redirect(`/leads/${id}/edit`);
  }

  const suggestedName = lead.companyName ?? `${lead.firstName} ${lead.lastName}`;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        backTo={`/leads/${id}`}
        backLabel="Back to the lead"
        title={`Convert ${lead.firstName} ${lead.lastName}`}
        description={lead.leadNumber}
      />
      <ConvertForm
        leadId={lead.id}
        leadLabel={lead.leadNumber}
        suggestedName={suggestedName}
        suggestedAmount={lead.estimatedValue ? String(lead.estimatedValue) : null}
        referredByPartnerName={lead.referredByPartner?.displayName ?? null}
        options={serialize({ accounts: options.accounts })}
      />
    </div>
  );
}
