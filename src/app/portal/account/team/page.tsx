import { requireUser } from "@/lib/authz";
import { getPortalTeam } from "@/server/portal-team";
import { PortalTeam } from "@/components/portal-team";

export default async function PartnerTeamPage() {
  const me = await requireUser();
  const team = await getPortalTeam();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your team</h1>
        <p className="mt-1 text-sm text-muted-foreground">Everyone at your company who can use the partner portal.</p>
      </div>
      <PortalTeam
        team={team}
        isAdmin={me.portalRole === "ADMIN"}
        adminMeans="An Admin can see commission, invite colleagues, change who is an Admin, and switch logins off. A User works leads, deals and quotes."
      />
    </div>
  );
}
