import { supabaseServer } from "@/lib/supabase";
import { PageHeader } from "@/components/ui";
import { PartnerCustomerForm } from "./customer-form";

/**
 * Registering a customer the partner has won.
 *
 * The partner has done the selling and wants the customer on our books under
 * their name, so the account, the contact and optionally the first deal are all
 * created together.
 */
export default async function NewPartnerCustomerPage() {
  const db = await supabaseServer();
  const { data: currencies } = await db
    .from("currency")
    .select("code, name")
    .eq("active", true)
    .order("code");

  return (
    <>
      <PageHeader
        backTo="/portal/customers"
        backLabel="Back to your customers"
        title="Add a customer"
        description="For a customer you have won. We create the account and their contact, and credit you as the partner who brought them."
      />
      <PartnerCustomerForm currencies={currencies ?? [{ code: "PKR", name: "Pakistani Rupee" }]} />
    </>
  );
}
