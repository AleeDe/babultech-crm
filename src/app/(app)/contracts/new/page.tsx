import { getContractFormOptions } from "@/server/contracts";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ContractForm, type ContractFormOptions } from "../contract-form";

export default async function NewContractPage() {
  const user = await requirePermission(PERMISSIONS.CONTRACT_WRITE);
  const options = await getContractFormOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="New contract"
        description="Usually the accepted quote turned into a term. Linking it back to the deal is what lets partner commission find its way home."
      />
      <ContractForm
        options={serialize(options) as unknown as ContractFormOptions}
        currentUserId={user.id}
      />
    </div>
  );
}
