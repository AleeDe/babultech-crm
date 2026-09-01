import { getContractFormOptions } from "@/server/contracts";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ContractForm, type ContractFormOptions } from "../contract-form";

export default async function NewContractPage({
  searchParams,
}: {
  // Set when arriving from an accepted quotation, so the customer, the quote
  // and the deal are already chosen and the value carries across.
  searchParams: Promise<{ quotationId?: string; accountId?: string; opportunityId?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.CONTRACT_WRITE)) return <Forbidden what="contracts" />;
  const [options, params] = await Promise.all([getContractFormOptions(), searchParams]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="New contract"
        description="Usually the accepted quote turned into a term. Linking it back to the deal is what lets partner commission find its way home."
      />
      <ContractForm
        options={serialize(options) as unknown as ContractFormOptions}
        prefill={{
          accountId: params.accountId,
          quotationId: params.quotationId,
          opportunityId: params.opportunityId,
        }}
        currentUserId={user.id}
      />
    </div>
  );
}
