import { getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { LeadForm } from "../lead-form";

export default async function NewLeadPage() {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="leads" />;
  const options = await getFormOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo="/leads"
        backLabel="Back to leads"
        title="New lead"
        description="An unqualified prospect. Nothing else is created until you convert it."
      />
      <LeadForm
        options={serialize({
          users: options.users,
          campaigns: options.campaigns,
          partners: options.partners,
        })}
        currentUserId={user.id}
      />
    </div>
  );
}
