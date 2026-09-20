import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageGuide } from "@/components/page-guide";
import { requireUser, can, AuthorizationError, PERMISSIONS } from "@/lib/authz";
import { PicklistProvider } from "@/components/picklist";
import { getPicklistMap } from "@/server/picklists";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
    const user = await requireUser();

    // External logins never see the internal app, whatever they type in the
    // address bar. Each portal's layout enforces the reverse, and the database
    // refuses them independently: both fail app_is_internal().
    if (user.userType === "PARTNER" || user.partnerId) redirect("/portal");
    if (user.userType === "CUSTOMER") redirect("/support");

    // The configurable dropdown values, loaded once for every form.
    const picklists = await getPicklistMap();

    return (
      <AppShell
        user={{ fullName: user.fullName, email: user.email, roleName: user.roleName }}
        isAdmin={can(user, PERMISSIONS.ADMIN)}
        permissions={user.permissions}
      >
        {/* In the layout rather than on each page: eighty pages would each need
            the same import and the same placement, and any one of them could be
            forgotten. The guide keys off the pathname, so it knows which screen
            it is on without being told. */}
        <PageGuide />
        <PicklistProvider value={picklists}>{children}</PicklistProvider>
      </AppShell>
    );
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/login");
    throw err;
  }
}
