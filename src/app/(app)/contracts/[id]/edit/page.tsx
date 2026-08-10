import { notFound } from "next/navigation";
import { getContract, getContractFormOptions } from "@/server/contracts";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ContractForm, type ContractDefaults, type ContractFormOptions } from "../../contract-form";

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.CONTRACT_WRITE);

  const [contract, options] = await Promise.all([getContract(id), getContractFormOptions()]);
  if (!contract) notFound();

  const defaults = serialize({
    id: contract.id,
    name: contract.name,
    accountId: contract.accountId,
    opportunityId: contract.opportunityId,
    quotationId: contract.quotationId,
    ownerUserId: contract.ownerUserId,
    contractType: contract.contractType,
    status: contract.status,
    startDate: contract.startDate,
    endDate: contract.endDate,
    contractValue: contract.contractValue,
    currencyCode: contract.currencyCode,
    billingFrequency: contract.billingFrequency,
    renewalType: contract.renewalType,
    noticePeriodDays: contract.noticePeriodDays,
    signedDate: contract.signedDate,
    terminationReason: contract.terminationReason,
  }) as unknown as ContractDefaults;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${contract.name}`} description={contract.contractNumber} />
      <ContractForm
        options={serialize(options) as unknown as ContractFormOptions}
        defaults={defaults}
        currentUserId={user.id}
      />
    </div>
  );
}
