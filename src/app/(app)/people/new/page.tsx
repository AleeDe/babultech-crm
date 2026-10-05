import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { getHiringOptions } from "@/server/people";
import { HireWizard } from "./hire-wizard";

export default async function NewHirePage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.PEOPLE_WRITE)) return <Forbidden what="hiring" />;
  const options = await getHiringOptions();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Hire someone" description="Their details, the contract and what they get. Then sign the contract and create their login." backTo="/people" backLabel="People" />
      <HireWizard options={options} />
    </div>
  );
}
