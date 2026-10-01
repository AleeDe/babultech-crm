import { requireUser } from "@/lib/authz";
import { getPortalTeam } from "@/server/portal-team";
import { PortalTeam } from "@/components/portal-team";

export default async function SupportTeamPage() {
  const me = await requireUser();
  const team = await getPortalTeam();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your team</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everyone at your company who can use this portal.</p>
      </div>
      <PortalTeam
        team={team}
        isAdmin={me.portalRole === "ADMIN"}
        adminMeans="An Admin can invite colleagues, change who is an Admin, switch logins off, and approve project deliverables."
      />
    </div>
  );
}
