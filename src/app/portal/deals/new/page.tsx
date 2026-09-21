import Link from "next/link";
import { Plus } from "lucide-react";
import { supabaseServer } from "@/lib/supabase";
import { listMyAccountsForDeal } from "@/server/partner-customers";
import { getPicklistMap } from "@/server/picklists";
import { PageHeader, Card, CardContent, EmptyState, Button } from "@/components/ui";
import { PickAccountForDeal } from "./pick-account";

/** Deal types, when the picklist has not been set up. */
const FALLBACK_TYPES = [
  { value: "NEW", label: "New business" },
  { value: "UPSELL", label: "Upsell" },
  { value: "RENEWAL", label: "Renewal" },
];

/**
 * Starting an opportunity from the Opportunities tab.
 *
 * The same form as the one on an account, with the account chosen first
 * instead of implied. A partner thinking "I have a new deal" should not have to
 * work out which account page it lives behind.
 */
export default async function NewPortalDealPage() {
  const db = await supabaseServer();
  const [accounts, { data: currencies }, picklists] = await Promise.all([
    listMyAccountsForDeal(),
    db.from("currency").select("code, name").eq("active", true).order("code"),
    getPicklistMap().catch(() => ({})),
  ]);

  const fromPicklist = (picklists as Record<string, { value: string; label: string }[]>)
    ?.opportunity_type;
  const dealTypes = fromPicklist?.length
    ? fromPicklist.map((v) => ({ value: v.value, label: v.label }))
    : FALLBACK_TYPES;

  return (
    <>
      <PageHeader
        backTo="/portal/deals"
        backLabel="Back to opportunities"
        title="New opportunity"
        description="You are credited as the partner who sourced it, so commission follows it automatically."
      />

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10">
            <EmptyState
              title="No accounts yet"
              description="An opportunity belongs to one of your accounts. Add the customer first, and you can record what you are selling them at the same time."
              action={
                <Button asChild>
                  <Link href="/portal/customers/new">
                    <Plus className="h-4 w-4" /> Add an account
                  </Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <PickAccountForDeal
          accounts={accounts}
          currencies={currencies ?? [{ code: "PKR", name: "Pakistani Rupee" }]}
          dealTypes={dealTypes}
        />
      )}
    </>
  );
}
