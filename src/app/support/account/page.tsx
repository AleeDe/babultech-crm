import { redirect } from "next/navigation";
import { getCustomerContext } from "@/server/support-portal";
import { PageHeader, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { PasswordForm } from "./password-form";

/**
 * The customer's own account: who they are, and their password.
 *
 * getCustomerContext rather than requireUser: a page that throws on a missing
 * session races the layout's redirect and loses, which showed as a 404 instead
 * of the sign-in page.
 */
export default async function SupportAccountPage() {
  const me = await getCustomerContext();
  if (!me) redirect("/login");

  return (
    <>
      <PageHeader
        backTo="/support"
        backLabel="Back to my tickets"
        title="Your account"
        description={`Signed in as ${me.fullName}`}
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Change your password</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </>
  );
}
