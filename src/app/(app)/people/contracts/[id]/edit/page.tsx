import { notFound, redirect } from "next/navigation";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { getContract, getHiringOptions } from "@/server/people";
import { TermsEditor } from "../../terms-editor";
import { termsState } from "@/lib/people-forms";

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.PEOPLE_WRITE)) return <Forbidden what="contracts" />;
  const { id } = await params;
  const [data, options] = await Promise.all([getContract(id), getHiringOptions()]);
  if (!data) notFound();
  // Once it has gone out, the words are what was signed or is being signed.
  if (data.contract.status !== "DRAFT") redirect(`/people/contracts/${id}`);
  const c = data.contract;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Edit ${c.contractNumber}`} description={`${c.staff.fullName}'s draft contract.`} backTo={`/people/contracts/${id}`} backLabel={c.contractNumber} />
      <TermsEditor mode="edit" staffId={c.staff.id} contractId={id} initial={termsState(c)} options={options} selfUserId={c.staff.userId} />
    </div>
  );
}
