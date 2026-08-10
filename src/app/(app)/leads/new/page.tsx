import { getFormOptions } from "@/server/crm";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { LeadForm } from "../lead-form";

export default async function NewLeadPage() {
  const user = await requirePermission(PERMISSIONS.LEAD_WRITE);
  const options = await getFormOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
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
