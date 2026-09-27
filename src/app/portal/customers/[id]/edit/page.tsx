import { notFound } from "next/navigation";
import { getMyCustomer } from "@/server/partner-customers";
import { getPartnerLeadPicklists } from "@/server/partner-leads";
import { PageHeader } from "@/components/ui";
import { PartnerAccountForm } from "./account-form";

export default async function EditPortalAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [account, picklists] = await Promise.all([getMyCustomer(id), getPartnerLeadPicklists()]);
  if (!account) notFound();

  const address = (account.billingAddress ?? {}) as Record<string, string | undefined>;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        backTo={`/portal/customers/${id}`}
        backLabel="Back to the account"
        title={`Edit ${account.name}`}
        description={account.accountNumber}
      />
      <PartnerAccountForm
        account={{
          id: account.id,
          name: account.name,
          industry: account.industry ?? "",
          website: account.website ?? "",
          mainPhone: account.mainPhone ?? "",
          employeeCount: account.employeeCount != null ? String(account.employeeCount) : "",
          description: account.description ?? "",
          street: address.street ?? "",
          city: address.city ?? "",
          state: address.state ?? "",
          postalCode: address.postalCode ?? "",
          country: address.country ?? "",
        }}
        industries={picklists.industry}
      />
    </div>
  );
}
