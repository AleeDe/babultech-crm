import { notFound } from "next/navigation";
import { getContact, getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ContactForm, type ContactDefaults } from "../../contact-form";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.ACCOUNT_WRITE)) return <Forbidden what="contacts" />;
  const [contact, options] = await Promise.all([getContact(id), getFormOptions()]);
  if (!contact) notFound();

  const defaults = serialize({
    id: contact.id,
    accountId: contact.accountId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    jobTitle: contact.jobTitle,
    department: contact.department,
    email: contact.email,
    phone: contact.phone,
    mobile: contact.mobile,
    whatsapp: contact.whatsapp,
    contactRole: contact.contactRole,
    isPrimary: contact.isPrimary,
    preferredChannel: contact.preferredChannel,
    communicationConsent: contact.communicationConsent,
    partnerId: contact.partnerAsPerson?.id ?? null,
  }) as unknown as ContactDefaults;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Edit ${contact.firstName} ${contact.lastName}`}
        description={contact.account?.name ?? "Independent contact"}
      />
      <ContactForm options={serialize({ accounts: options.accounts })} defaults={defaults} />
    </div>
  );
}
