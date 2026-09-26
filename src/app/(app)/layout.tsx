import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageGuide } from "@/components/page-guide";
import { requireUser, can, AuthorizationError, PERMISSIONS } from "@/lib/authz";
import { PicklistProvider } from "@/components/picklist";
import { getPicklistMap } from "@/server/picklists";
import { CurrencyContextProvider } from "@/components/currency-context-provider";
import { ensureCurrencyContext } from "@/lib/currency-loader";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
    const user = await requireUser();

    // External logins never see the internal app, whatever they type in the
    // address bar. Each portal's layout enforces the reverse, and the database
    // refuses them independently: both fail app_is_internal().
    if (user.userType === "PARTNER" || user.partnerId) redirect("/portal");
    if (user.userType === "CUSTOMER") redirect("/support");

    // The configurable dropdown values, loaded once for every form.
    const [picklists, currencies] = await Promise.all([getPicklistMap(), ensureCurrencyContext()]);

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
        {/* The browser formats money with the same rates the server just used,
            or the two would render different text and fail to hydrate. */}
        <CurrencyContextProvider value={currencies}>
          <PicklistProvider value={picklists}>{children}</PicklistProvider>
        </CurrencyContextProvider>
      </AppShell>
    );
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/login");
    throw err;
  }
}
