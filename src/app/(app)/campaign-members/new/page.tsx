import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { CampaignMemberForm } from "../member-form";

export default async function NewCampaignMemberPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="campaign members" />;

  return (
    <>
      <PageHeader
        backTo="/campaign-members"
        backLabel="Back to members"
        title="New campaign member"
        description="Somebody marketing talks to. They stay here until they become a lead."
      />
      <CampaignMemberForm />
    </>
  );
}
