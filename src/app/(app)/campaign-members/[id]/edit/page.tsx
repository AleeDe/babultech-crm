import { notFound } from "next/navigation";
import { getCampaignMember } from "@/server/campaign-members";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { CampaignMemberForm } from "../../member-form";

export default async function EditCampaignMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="campaign members" />;

  const { id } = await params;
  const member = await getCampaignMember(id);
  if (!member) notFound();

  const name = `${member.firstName} ${member.lastName ?? ""}`.trim();

  return (
    <>
      <PageHeader
        backTo={`/campaign-members/${id}`}
        backLabel={`Back to ${name}`}
        title={`Edit ${name}`}
        description="Corrections here apply to this campaign's copy of them. The same person on another campaign is a separate record."
      />
      <CampaignMemberForm defaults={member} />
    </>
  );
}
