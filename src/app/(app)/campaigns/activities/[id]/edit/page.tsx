import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { getCampaignActivity } from "@/server/campaign-activities";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { ActivityForm } from "../../activity-form";

/**
 * Editing an activity, while it is still only a plan.
 *
 * Once something has gone out there is nothing here worth editing: changing the
 * subject line of an email people have already received would make the record
 * disagree with what they read. So a run activity is sent back to its own page
 * rather than shown a form that would refuse on save.
 */
export default async function EditCampaignActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="campaigns" />;

  const { id } = await params;
  const activity = await getCampaignActivity(id);
  if (!activity) notFound();

  if (["RUNNING", "COMPLETED"].includes(activity.status)) {
    redirect(`/campaigns/activities/${id}`);
  }

  const db = await supabaseServer();
  const { data: campaigns } = await db
    .from("campaign")
    .select("id, name")
    .is("deletedAt", null)
    .order("createdAt", { ascending: false });

  return (
    <>
      <PageHeader
        backTo={`/campaigns/activities/${id}`}
        backLabel="Back to the activity"
        title={`Edit ${activity.name}`}
        description={activity.campaign?.name ?? undefined}
      />
      <ActivityForm campaigns={campaigns ?? []} defaults={activity} />
    </>
  );
}
