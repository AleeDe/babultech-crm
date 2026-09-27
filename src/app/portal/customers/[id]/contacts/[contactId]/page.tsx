import { notFound } from "next/navigation";
import { getPartnerContact } from "@/server/partner-deals";
import { PageHeader } from "@/components/ui";
import { PartnerContactForm } from "./contact-form";

export default async function EditPortalContactPage({
  params,
}: {
  params: Promise<{ id: string; contactId: string }>;
}) {
  const { id, contactId } = await params;
  const contact = await getPartnerContact(contactId);
  // Row-level security returns nothing for a contact that is not the partner's,
  // and a contact reached through the wrong account is treated the same way.
  if (!contact || contact.accountId !== id) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        backTo={`/portal/customers/${id}`}
        backLabel="Back to the account"
        title={`${contact.firstName} ${contact.lastName}`}
        description="Edit their details"
      />
      <PartnerContactForm accountId={id} contact={contact} />
    </div>
  );
}
