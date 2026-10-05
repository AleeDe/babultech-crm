import { notFound } from "next/navigation";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { getHiringOptions, getPerson, getContract } from "@/server/people";
import { dayAfter, karachiToday, termEndDate, CONTRACT_TYPE_LABELS, type ContractType } from "@/lib/people";
import { TermsEditor } from "../../../contracts/terms-editor";
import { termsState, emptyTerms } from "@/lib/people-forms";

/**
 * A further contract: a renewal (same kind, next term), a conversion (to
 * employment or permanent), or a fresh one after a gap.
 */
export default async function NewContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; mode?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.PEOPLE_WRITE)) return <Forbidden what="contracts" />;
  const { id } = await params;
  const { from, mode } = await searchParams;
  const [person, options, previous] = await Promise.all([getPerson(id), getHiringOptions(), from ? getContract(from) : null]);
  if (!person) notFound();

  let initial = emptyTerms(options.currencies[0] ?? "PKR");
  let title = "New contract";
  let description = "A fresh contract for someone with no current one.";
  if (previous) {
    const prev = previous.contract;
    // A co-founder agreement has no end: its revision starts today and
    // replaces it when it starts.
    const start = !prev.endDate || (prev.status === "ENDED" && prev.endDate < karachiToday()) ? karachiToday() : dayAfter(prev.endDate);
    initial = { ...termsState(prev), startDate: start, templateId: "" };
    if (prev.contractType === "COFOUNDER") {
      title = `Revise ${person.staff.fullName}'s co-founder agreement`;
      description = `A new agreement replacing ${prev.contractNumber}, for a change of equity, areas or financials. Once signed it takes over on its start date and ${prev.contractNumber} is marked as replaced.`;
    } else if (mode === "convert") {
      const to = prev.contractType === "EMPLOYMENT" ? "PERMANENT" : "EMPLOYMENT";
      initial = { ...initial, contractType: to, tenureMonths: 12 };
      title = `Convert ${person.staff.fullName}`;
      description = `From ${CONTRACT_TYPE_LABELS[prev.contractType as ContractType].toLowerCase()} to a new kind of contract, usually employment or permanent. It starts the day after ${prev.contractNumber} ends unless you change the date.`;
    } else {
      title = `Renew ${person.staff.fullName}'s contract`;
      description = `The next term after ${prev.contractNumber}, starting the day after it ends. Change the pay or benefits here, as agreed at the appraisal.`;
    }
    initial.endDate = initial.contractType === "COFOUNDER" ? "" : termEndDate(initial.startDate, initial.contractType === "PERMANENT" ? 12 : initial.tenureMonths);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={title} description={description} backTo={`/people/${id}`} backLabel={person.staff.fullName} />
      <TermsEditor mode="create" staffId={id} previousContractId={previous?.contract.id ?? null} initial={initial} options={options} selfUserId={person.staff.userId} />
    </div>
  );
}
