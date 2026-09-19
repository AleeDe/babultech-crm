import Link from "next/link";
import { getUserTeams } from "@/server/user-teams";
import { PageHeader, Forbidden } from "@/components/ui";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { TeamEditor } from "./team-editor";

export default async function UserTeamsPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="team administration" />;
  const { id } = await params;
  const data = await getUserTeams(id);
  return <div className="mx-auto max-w-3xl">
    <PageHeader title={`Teams · ${data.user.fullName}`} description="Team membership affects TEAM-scoped record access. Department and project assignments remain separate." />
    <Link href={`/users/${id}`} className="text-primary hover:underline">Back to user</Link>
    <TeamEditor userId={id} data={data} />
  </div>;
}
