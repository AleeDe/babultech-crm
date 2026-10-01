import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getMergeCandidates } from "@/server/record-merge";
import { PageHeader, Forbidden, Alert } from "@/components/ui";
import { RecordMergeForm } from "@/components/record-merge-form";

/** Choosing what survives a merge of contacts. The records arrive in the URL. */
export default async function MergeContactsPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ACCOUNT_WRITE)) return <Forbidden what="contacts" />;
  const { ids } = await searchParams;
  const chosen = (ids ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  const records = chosen.length ? await getMergeCandidates("contact", chosen) : [];

  if (records.length < 2) {
    return (
      <>
        <PageHeader backTo="/contacts/duplicates" backLabel="Back to duplicates" title="Merge contacts" />
        <Alert tone="warning">A merge needs at least two contacts. Go back and choose a group - one of them may already have been merged.</Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        backTo="/contacts/duplicates"
        backLabel="Back to duplicates"
        title="Merge contacts"
        description="Pick the record to keep, then the value to keep for each field. Nothing is decided until you press Merge."
      />
      <RecordMergeForm entity="contact" records={records} />
    </>
  );
}
