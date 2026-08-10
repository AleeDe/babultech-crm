import { getFormOptions } from "@/server/crm";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ContactForm } from "../contact-form";

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  await requirePermission(PERMISSIONS.ACCOUNT_WRITE);
  const [{ accountId }, options] = await Promise.all([searchParams, getFormOptions()]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New contact"
        description="A person. Attach them to a company, or leave the company blank if they stand alone."
      />
      <ContactForm
        options={serialize({ accounts: options.accounts })}
        lockedAccountId={accountId}
      />
    </div>
  );
}
