import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireUser, AuthorizationError } from "@/lib/authz";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
    const user = await requireUser();
    return (
      <AppShell user={{ fullName: user.fullName, email: user.email, roleName: user.roleName }}>
        {children}
      </AppShell>
    );
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/login");
    throw err;
  }
}
