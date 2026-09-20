import { redirect } from "next/navigation";
import { SupportShell } from "@/components/support-shell";
import { requireUser, AuthorizationError } from "@/lib/authz";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * The customer portal's front door, and one third of the isolation between the
 * three kinds of login:
 *
 *   - no session            → /login
 *   - employee              → / (the internal app)
 *   - partner               → /portal
 *   - customer              → here
 *
 * The internal app's layout and the partner portal's do the reverse. None of
 * them relies on the others, so a mistake in one does not open another, and the
 * database refuses the same crossings independently: a customer login fails
 * app_is_internal(), so its policies return nothing whatever a page asks for.
 */
export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthorizationError) redirect("/login");
    throw err;
  }

  if (user.userType === "PARTNER") redirect("/portal");
  if (user.userType !== "CUSTOMER") redirect("/");

  // The account name, read with the admin client: it is the one thing the shell
  // needs before any page runs, and it is already fixed by the session.
  const { data: contact } = await supabaseAdmin()
    .from("contact")
    .select("account:account ( name )")
    .eq("id", user.contactId!)
    .maybeSingle();

  const account = Array.isArray(contact?.account) ? contact?.account[0] : contact?.account;

  return (
    <SupportShell
      account={{ name: account?.name ?? "Your company" }}
      user={{ fullName: user.fullName, email: user.email }}
    >
      {children}
    </SupportShell>
  );
}
