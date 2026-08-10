import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, auth } from "@/lib/auth";
import { Button, Card, Field, Input, Alert } from "@/components/ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: "/",
      });
    } catch (err) {
      // next-auth throws a redirect internally on success — rethrow it.
      if (err instanceof AuthError) redirect("/login?error=1");
      throw err;
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded bg-primary font-bold text-primary-foreground">
            BT
          </span>
          <h1 className="text-xl font-semibold">BabulTech CRM</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        {error && (
          <div className="mb-4">
            <Alert tone="danger">That email and password combination did not work.</Alert>
          </div>
        )}

        <form action={login} className="space-y-4">
          <Field label="Email" required>
            <Input name="email" type="email" autoComplete="email" required placeholder="you@babultech.com" />
          </Field>
          <Field label="Password" required>
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
