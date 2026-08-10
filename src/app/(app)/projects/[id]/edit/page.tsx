import { notFound } from "next/navigation";
import { getProject, getProjectFormOptions } from "@/server/projects";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ProjectForm, type ProjectDefaults, type ProjectFormOptions } from "../../project-form";

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const [project, options] = await Promise.all([getProject(id), getProjectFormOptions()]);
  if (!project) notFound();

  const defaults = serialize({
    id: project.id,
    name: project.name,
    accountId: project.accountId,
    opportunityId: project.opportunityId,
    contractId: project.contractId,
    projectManagerId: project.projectManagerId,
    status: project.status,
    health: project.health,
    billingType: project.billingType,
    startDate: project.startDate,
    plannedEndDate: project.plannedEndDate,
    contractValue: project.contractValue,
    currencyCode: project.currencyCode,
    approvedHours: project.approvedHours,
    scope: project.scope,
  }) as unknown as ProjectDefaults;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${project.name}`} description={project.projectNumber} />
      <ProjectForm
        options={serialize(options) as unknown as ProjectFormOptions}
        defaults={defaults}
        currentUserId={user.id}
      />
    </div>
  );
}
