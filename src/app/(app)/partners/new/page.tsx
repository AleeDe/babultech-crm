import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { PartnerForm } from "./partner-form";

export default async function NewPartnerPage() {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.PARTNER_WRITE)) return <Forbidden what="partners" />;
  const [users, accounts, contacts, plans, currencies] = await Promise.all([
    (async () => {
      const db = await supabaseServer();
      const { data } = await db
        .from("app_user")
        .select("id, fullName")
        .eq("status", "ACTIVE")
        .is("deletedAt", null)
        .order("fullName");
      return data ?? [];
    })(),
    // `partner: null` and `partnerAsPerson: null` are not-exists tests on a
    // relation, which PostgREST cannot express. The ids already taken are
    // fetched and excluded instead — one partner record per account/contact.
    (async () => {
      const db = await supabaseServer();
      const [{ data: accounts }, { data: taken }] = await Promise.all([
        db
          .from("account")
          .select("id, name, accountType")
          .is("deletedAt", null)
          .order("name"),
        db.from("partner").select("accountId").not("accountId", "is", null),
      ]);
      const used = new Set((taken ?? []).map((p) => p.accountId));
      return (accounts ?? []).filter((a) => !used.has(a.id));
    })(),
    (async () => {
      const db = await supabaseServer();
      const [{ data: contacts }, { data: taken }] = await Promise.all([
        db
          .from("contact")
          .select("id, firstName, lastName, email")
          .is("deletedAt", null)
          .order("lastName"),
        db.from("partner").select("contactId").not("contactId", "is", null),
      ]);
      const used = new Set((taken ?? []).map((p) => p.contactId));
      return (contacts ?? []).filter((c) => !used.has(c.id));
    })(),
    (async () => {
      const db = await supabaseServer();
      const { data } = await db
        .from("commission_plan")
        .select("id, name, rateType, flatPercent")
        .is("deletedAt", null)
        .eq("active", true)
        .order("name");
      return data ?? [];
    })(),
    (async () => {
      const db = await supabaseServer();
      const { data } = await db.from("currency").select("*").eq("active", true).order("code");
      return data ?? [];
    })(),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo="/partners"
        backLabel="Back to partners"
        title="Add partner"
        description="A partner can be a company or a single person. Individuals are stored as a contact with no account, so nothing fake ends up in your customer list."
      />
      <PartnerForm options={serialize({ users, accounts, contacts, plans, currencies })} />
    </div>
  );
}
