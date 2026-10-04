import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { PartnerForm, type SavedPartner } from "../../new/partner-form";

/**
 * Editing a partner: the relationship, commission and payment details. Who
 * they are (company name, people) is edited on their account or contact.
 */
export default async function EditPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.PARTNER_WRITE)) return <Forbidden what="partners" />;
  const { id } = await params;
  const db = await supabaseServer();
  const [{ data: partner }, { data: currencies }] = await Promise.all([
    db
      .from("partner")
      .select("id, displayName, partnerNumber, partnerType, tier, status, partnerManagerId, territory, startDate, agreementExpiryDate, defaultCommissionPercent, payoutCurrencyCode, taxNumber, withholdingTaxPercent, email, phone, website, notes, bankDetails, deletedAt")
      .eq("id", id)
      .maybeSingle(),
    db.from("currency").select("code, name").eq("active", true).order("code"),
  ]);
  if (!partner || partner.deletedAt) notFound();

  const saved: SavedPartner = {
    id: partner.id as string,
    partnerType: String(partner.partnerType),
    tier: String(partner.tier ?? "SILVER"),
    status: String(partner.status),
    partnerManagerId: (partner.partnerManagerId as string | null) ?? null,
    territory: (partner.territory as string | null) ?? null,
    startDate: (partner.startDate as string | null) ?? null,
    agreementExpiryDate: (partner.agreementExpiryDate as string | null) ?? null,
    defaultCommissionPercent: partner.defaultCommissionPercent == null ? null : String(partner.defaultCommissionPercent),
    payoutCurrencyCode: String(partner.payoutCurrencyCode ?? "PKR"),
    taxNumber: (partner.taxNumber as string | null) ?? null,
    withholdingTaxPercent: partner.withholdingTaxPercent == null ? null : String(partner.withholdingTaxPercent),
    email: (partner.email as string | null) ?? null,
    phone: (partner.phone as string | null) ?? null,
    website: (partner.website as string | null) ?? null,
    notes: (partner.notes as string | null) ?? null,
    bankDetails: (partner.bankDetails as SavedPartner["bankDetails"]) ?? null,
  };

  return (
    <>
      <PageHeader
        backTo={`/partners/${id}`}
        backLabel="Back to the partner"
        title={`Edit ${partner.displayName}`}
        description={`${partner.partnerNumber} · the name and people are edited on their account or contact`}
      />
      <div className="max-w-4xl">
        <PartnerForm options={{ users: [], accounts: [], contacts: [], currencies: (currencies ?? []) as { code: string; name: string }[] }} partner={saved} />
      </div>
    </>
  );
}
