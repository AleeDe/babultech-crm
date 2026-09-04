import { getCaseFormOptions } from "@/server/cases";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { CaseForm, type CaseFormOptions } from "../case-form";

export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.CASE_WRITE)) return <Forbidden what="support cases" />;
  const [{ accountId }, options] = await Promise.all([searchParams, getCaseFormOptions()]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo="/cases"
        backLabel="Back to cases"
        title="New case"
        description="Raised against a customer and always for one of that customer's contacts. SLA deadlines are set from the priority."
      />
      <CaseForm
        options={serialize(options) as unknown as CaseFormOptions}
        lockedAccountId={accountId}
      />
    </div>
  );
}
