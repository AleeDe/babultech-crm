import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { PageHeader } from "@/components/ui";
import { AddContactForm } from "./add-contact-form";

export default async function AddPartnerContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await supabaseServer();

  // account_partner_read is what makes this safe: a partner asking for an
  // account they did not source gets no row, and lands on not-found rather than
  // on a form that would fail at the last step.
  const { data: account } = await db
    .from("account")
    .select("id, name, accountNumber")
    .eq("id", id)
    .is("deletedAt", null)
    .maybeSingle();

  if (!account) notFound();

  return (
    <>
      <PageHeader
        backTo="/portal/customers"
        backLabel="Back to accounts"
        title={`Add an employee at ${account.name}`}
        description="Someone who works there and you deal with. They will not get a login."
      />
      <AddContactForm accountId={account.id} accountName={account.name} />
    </>
  );
}
