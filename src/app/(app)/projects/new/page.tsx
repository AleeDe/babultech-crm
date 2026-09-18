import { getProjectFormOptions } from "@/server/projects";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ProjectForm, type ProjectFormOptions } from "../project-form";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.PROJECT_MANAGE)) return <Forbidden what="projects" />;
  const [{ accountId }, options] = await Promise.all([searchParams, getProjectFormOptions()]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo="/projects"
        backLabel="Back to projects"
        title="New project"
        description="Phases, milestones, tasks and the team are set up on the workspace once the project exists."
      />
      <ProjectForm
        options={serialize(options) as unknown as ProjectFormOptions}
        currentUserId={user.id}
        lockedAccountId={accountId}
      />
    </div>
  );
}
