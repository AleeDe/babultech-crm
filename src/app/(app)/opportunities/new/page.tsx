import { getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { OpportunityForm, type OpportunityFormOptions } from "../opportunity-form";

export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="opportunities" />;
  const [{ accountId }, options] = await Promise.all([searchParams, getFormOptions()]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="New opportunity"
        description="Attach partners and their revenue split from the deal page once it exists."
      />
      <OpportunityForm
        options={serialize(options) as unknown as OpportunityFormOptions}
        currentUserId={user.id}
        lockedAccountId={accountId}
      />
    </div>
  );
}
