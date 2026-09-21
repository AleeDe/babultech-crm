import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getPicklistMap } from "@/server/picklists";
import { PageHeader, Forbidden } from "@/components/ui";
import { CampaignMemberImportForm } from "./import-form";

export default async function ImportCampaignMembersPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="campaign members" />;

  const picklists = (await getPicklistMap().catch(() => ({}))) as Record<
    string,
    { value: string; label: string }[]
  >;

  return (
    <>
      <PageHeader
        backTo="/campaign-members"
        backLabel="Back to members"
        title="Import a list"
        description="A spreadsheet of people to market to. Anyone already on the list is updated rather than added twice."
      />
      <CampaignMemberImportForm
        businessTypes={picklists.business_type ?? []}
        companySizes={picklists.company_size ?? []}
      />
    </>
  );
}
