import { notFound } from "next/navigation";
import { getCase, getCaseFormOptions } from "@/server/cases";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { CaseForm, type CaseDefaults, type CaseFormOptions } from "../../case-form";

export default async function EditCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.CASE_WRITE)) return <Forbidden what="support cases" />;
  const [supportCase, options] = await Promise.all([getCase(id), getCaseFormOptions()]);
  if (!supportCase) notFound();

  const defaults = serialize({
    id: supportCase.id,
    caseNumber: supportCase.caseNumber,
    subject: supportCase.subject,
    description: supportCase.description,
    accountId: supportCase.accountId,
    contactId: supportCase.contactId,
    categoryId: supportCase.categoryId,
    ownerUserId: supportCase.ownerUserId,
    teamId: supportCase.teamId,
    caseType: supportCase.caseType,
    priority: supportCase.priority,
    source: supportCase.source,
    status: supportCase.status,
    rootCause: supportCase.rootCause,
    resolution: supportCase.resolution,
    satisfactionScore: supportCase.satisfactionScore,
  }) as unknown as CaseDefaults;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo={`/cases/${id}`}
        backLabel="Back to the case"
        title={`Edit ${supportCase.caseNumber}`}
        description={`${supportCase.subject} · ${supportCase.account?.name}`}
      />
      <CaseForm
        options={serialize(options) as unknown as CaseFormOptions}
        defaults={defaults}
      />
    </div>
  );
}
