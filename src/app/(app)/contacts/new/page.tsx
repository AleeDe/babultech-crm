import { getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ContactForm } from "../contact-form";

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.ACCOUNT_WRITE)) return <Forbidden what="contacts" />;
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
