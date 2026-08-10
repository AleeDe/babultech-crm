import { getCaseFormOptions } from "@/server/cases";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { CaseForm, type CaseFormOptions } from "../case-form";

export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  await requirePermission(PERMISSIONS.CASE_WRITE);
  const [{ accountId }, options] = await Promise.all([searchParams, getCaseFormOptions()]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
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
