import { notFound } from "next/navigation";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { getPerson, getReportingLine } from "@/server/people";
import { ProfileEditor } from "./profile-editor";

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.PEOPLE_WRITE)) return <Forbidden what="editing profiles" />;
  const { id } = await params;
  const [data, line] = await Promise.all([getPerson(id), getReportingLine(id)]);
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Edit ${data.staff.fullName}`} description="Who they report to, personal details, background and online profiles. Pay and other terms are changed on the contract." backTo={`/people/${id}`} backLabel={data.staff.fullName} />
      <ProfileEditor staffId={id} initial={data.staff} reportingLine={line} />
    </div>
  );
}
