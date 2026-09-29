import { requireUser, can, canAny, PERMISSIONS } from "@/lib/authz";
import { listTemplates } from "@/server/communications";
import { PageHeader, Forbidden } from "@/components/ui";
import { TemplatesEditor } from "./templates-editor";

export default async function EmailTemplatesPage() {
  const me = await requireUser();
  if (!canAny(me, PERMISSIONS.LEAD_READ, PERMISSIONS.ACCOUNT_READ)) return <Forbidden what="email templates" />;
  const templates = await listTemplates();
  return (
    <>
      <PageHeader
        title="Email templates"
        description="Subjects and messages to start an email from, with placeholders each person's details fill in. Anyone who sends email can add one; its author or an administrator can change it."
      />
      <TemplatesEditor
        templates={templates}
        canAdd={canAny(me, PERMISSIONS.LEAD_WRITE, PERMISSIONS.ACCOUNT_WRITE)}
        isAdmin={can(me, PERMISSIONS.ADMIN)}
      />
    </>
  );
}
