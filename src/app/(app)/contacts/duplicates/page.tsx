import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { findDuplicates } from "@/server/record-merge";
import { PageHeader, Forbidden } from "@/components/ui";
import { DuplicateGroups } from "@/components/duplicate-groups";

/** Contacts that look like the same contact, to be merged by someone who can tell. */
export default async function DuplicateContactsPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ACCOUNT_READ)) return <Forbidden what="contacts" />;
  const groups = await findDuplicates("contact");
  return (
    <>
      <PageHeader
        backTo="/contacts"
        backLabel="Back to contacts"
        title="Possible duplicates"
        description="Contacts sharing an email address or a phone, mobile or WhatsApp number (on the last nine digits), or the same name at the same account."
      />
      <DuplicateGroups entity="contact" groups={groups} canMerge={can(me, PERMISSIONS.ACCOUNT_WRITE)} />
    </>
  );
}
