import { notFound } from "next/navigation";
import { getOpportunity } from "@/server/opportunities";
import { getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Alert , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import {
  OpportunityForm,
  type OpportunityDefaults,
  type OpportunityFormOptions,
} from "../../opportunity-form";

export default async function EditOpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="opportunities" />;
  const [opp, options] = await Promise.all([getOpportunity(id), getFormOptions()]);
  if (!opp) notFound();

  const defaults = serialize({
    id: opp.id,
    name: opp.name,
    accountId: opp.accountId,
    primaryContactId: opp.primaryContactId,
    ownerUserId: opp.ownerUserId,
    campaignId: opp.campaignId,
    amount: opp.amount,
    currencyCode: opp.currencyCode,
    probabilityPercent: opp.probabilityPercent,
    expectedCloseDate: opp.expectedCloseDate,
    opportunityType: opp.opportunityType,
    leadSource: opp.leadSource,
    nextStep: opp.nextStep,
    description: opp.description,
    lines: opp.lines.map((l: Record<string, any>) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRateId: l.taxRateId,
    })),
  }) as unknown as OpportunityDefaults;

  const accrued = opp.commissionRecords.length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Edit ${opp.name}`}
        description={`${opp.opportunityNumber} · ${opp.account?.name}`}
      />
      {accrued && (
        <div className="mb-6">
          <Alert tone="warning">
            Commission has accrued on this deal, so its amount is locked. Claw the commission back
            from the deal page if the value was wrong.
          </Alert>
        </div>
      )}
      <OpportunityForm
        options={serialize(options) as unknown as OpportunityFormOptions}
        defaults={defaults}
        currentUserId={user.id}
      />
    </div>
  );
}
