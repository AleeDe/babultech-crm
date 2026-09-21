import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { ActivityForm } from "../activity-form";

export default async function NewCampaignActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="campaigns" />;

  const { campaignId } = await searchParams;
  const db = await supabaseServer();
  const { data: campaigns } = await db
    .from("campaign")
    .select("id, name")
    .is("deletedAt", null)
    .order("createdAt", { ascending: false });

  return (
    <>
      <PageHeader
        backTo={campaignId ? `/campaigns/${campaignId}` : "/campaigns"}
        backLabel="Back"
        title="New campaign activity"
        description="A round of outreach: an email, some calls, a webinar."
      />
      <ActivityForm campaigns={campaigns ?? []} lockedCampaignId={campaignId} />
    </>
  );
}
