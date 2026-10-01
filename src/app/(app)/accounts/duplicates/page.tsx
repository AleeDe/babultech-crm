import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { findDuplicates } from "@/server/record-merge";
import { PageHeader, Forbidden } from "@/components/ui";
import { DuplicateGroups } from "@/components/duplicate-groups";

/** Accounts that look like the same account, to be merged by someone who can tell. */
export default async function DuplicateAccountsPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ACCOUNT_READ)) return <Forbidden what="accounts" />;
  const groups = await findDuplicates("account");
  return (
    <>
      <PageHeader
        backTo="/accounts"
        backLabel="Back to accounts"
        title="Possible duplicates"
        description="Accounts sharing a name (ignoring Ltd, Pvt and the like), a website, a tax number or a phone number."
      />
      <DuplicateGroups entity="account" groups={groups} canMerge={can(me, PERMISSIONS.ACCOUNT_WRITE)} />
    </>
  );
}
