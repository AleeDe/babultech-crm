import { getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { LeadImportForm } from "./import-form";

export default async function ImportLeadsPage() {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="importing leads" />;

  const options = await getFormOptions();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Import leads"
        description="Paste from a spreadsheet or upload a CSV, then say which column is which."
      />
      <LeadImportForm
        users={serialize(options.users)}
        campaigns={serialize(options.campaigns)}
        partners={serialize(options.partners)}
        currentUserId={user.id}
      />
    </div>
  );
}
