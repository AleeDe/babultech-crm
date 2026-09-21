import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { getPicklistMap } from "@/server/picklists";
import { PageHeader } from "@/components/ui";
import { AddDealForm } from "./add-deal-form";

/** Deal types, when the picklist has not been set up. */
const FALLBACK_TYPES = [
  { value: "NEW", label: "New business" },
  { value: "UPSELL", label: "Upsell" },
  { value: "RENEWAL", label: "Renewal" },
];

export default async function AddPartnerDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await supabaseServer();

  const [{ data: account }, { data: contacts }, { data: currencies }, picklists] =
    await Promise.all([
      db
        .from("account")
        .select("id, name, billingAddress")
        .eq("id", id)
        .is("deletedAt", null)
        .maybeSingle(),
      db
        .from("contact")
        .select("id, firstName, lastName, jobTitle")
        .eq("accountId", id)
        .is("deletedAt", null)
        .order("isPrimary", { ascending: false }),
      db.from("currency").select("code, name").eq("active", true).order("code"),
      getPicklistMap().catch(() => ({})),
    ]);

  if (!account) notFound();

  const fromPicklist = (picklists as Record<string, { value: string; label: string }[]>)
    ?.opportunity_type;
  const dealTypes = fromPicklist?.length
    ? fromPicklist.map((v) => ({ value: v.value, label: v.label }))
    : FALLBACK_TYPES;

  // An address already on file is not overwritten, so the form says so rather
  // than inviting the partner to type one that would be silently discarded.
  const address = account.billingAddress as Record<string, unknown> | null;
  const hasAddress = Boolean(address && Object.keys(address).length > 0);

  return (
    <>
      <PageHeader
        backTo="/portal/customers"
        backLabel="Back to accounts"
        title={`New deal at ${account.name}`}
        description="You are credited as the partner who sourced it, so commission follows it automatically."
      />
      <AddDealForm
        accountId={account.id}
        accountName={account.name}
        contacts={contacts ?? []}
        currencies={currencies ?? [{ code: "PKR", name: "Pakistani Rupee" }]}
        dealTypes={dealTypes}
        hasAddress={hasAddress}
      />
    </>
  );
}
