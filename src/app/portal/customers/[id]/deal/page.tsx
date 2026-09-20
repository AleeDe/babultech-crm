import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { PageHeader } from "@/components/ui";
import { AddDealForm } from "./add-deal-form";

export default async function AddPartnerDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await supabaseServer();

  const [{ data: account }, { data: contacts }, { data: currencies }] = await Promise.all([
    db.from("account").select("id, name").eq("id", id).is("deletedAt", null).maybeSingle(),
    db
      .from("contact")
      .select("id, firstName, lastName, jobTitle")
      .eq("accountId", id)
      .is("deletedAt", null)
      .order("isPrimary", { ascending: false }),
    db.from("currency").select("code, name").eq("active", true).order("code"),
  ]);

  if (!account) notFound();

  return (
    <>
      <PageHeader
        backTo="/portal/customers"
        backLabel="Back to your customers"
        title={`New deal at ${account.name}`}
        description="You are credited as the partner who sourced it, so commission follows it automatically."
      />
      <AddDealForm
        accountId={account.id}
        contacts={contacts ?? []}
        currencies={currencies ?? [{ code: "PKR", name: "Pakistani Rupee" }]}
      />
    </>
  );
}
