import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageGuide } from "@/components/page-guide";
import { requireUser, can, AuthorizationError, PERMISSIONS } from "@/lib/authz";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
    const user = await requireUser();

    // External partner logins never see the internal app, whatever they type
    // in the address bar. The portal layout enforces the reverse.
    if (user.partnerId) redirect("/portal");

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
        {children}
      </AppShell>
    );
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/login");
    throw err;
  }
}
