import { notFound } from "next/navigation";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { getPerson } from "@/server/people";
import { ProfileEditor } from "./profile-editor";

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.PEOPLE_WRITE)) return <Forbidden what="editing profiles" />;
  const { id } = await params;
  const data = await getPerson(id);
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Edit ${data.staff.fullName}`} description="Personal details, background and online profiles. Contract terms are changed on the contract." backTo={`/people/${id}`} backLabel={data.staff.fullName} />
      <ProfileEditor staffId={id} initial={data.staff} />
    </div>
  );
}
