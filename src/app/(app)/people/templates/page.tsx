import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { listTemplates } from "@/server/people";
import { TemplateEditor } from "./template-editor";

export default async function ContractTemplatesPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.PEOPLE_WRITE)) return <Forbidden what="contract templates" />;
  const templates = await listTemplates();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Contract templates" description="The wording each kind of contract starts from. A contract copies it when prepared, so changing a template never changes a contract already made." backTo="/people" backLabel="People" />
      <TemplateEditor templates={templates} />
    </div>
  );
}
