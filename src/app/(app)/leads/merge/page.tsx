import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getLeadsForMerge } from "@/server/lead-merge";
import { PageHeader, Forbidden, Alert } from "@/components/ui";
import { MergeForm } from "./merge-form";

/**
 * Choosing what survives a merge.
 *
 * The leads arrive in the URL rather than in a store, so the page can be
 * reloaded and shared, and so a half-made decision is never sitting behind a
 * back button with no idea what it was about.
 */
export default async function MergeLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="leads" />;

  const { ids } = await searchParams;
  const leadIds = (ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));

  const leads = leadIds.length ? await getLeadsForMerge(leadIds) : [];

  if (leads.length < 2) {
    return (
      <>
        <PageHeader backTo="/leads/duplicates" backLabel="Back to duplicates" title="Merge leads" />
        <Alert tone="warning">
          A merge needs at least two leads. Go back and choose a group.
          {leads.length === 1 &&
            " One of the leads you chose may already have been merged or converted."}
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        backTo="/leads/duplicates"
        backLabel="Back to duplicates"
        title="Merge leads"
        description="Pick the record to keep, then pick which value to keep for each field. Nothing is decided until you press Merge."
      />
      <MergeForm leads={leads} />
    </>
  );
}
