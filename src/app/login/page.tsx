import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, auth } from "@/lib/auth";
import { Button, Card, Field, Input, Alert } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

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
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-muted/40 p-4">
      {/* Two soft washes behind the card. Decorative only — the form reads the
          same with them stripped out. */}
      <div
        className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-32 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl"
        aria-hidden
      />

      <Card className="relative w-full max-w-sm p-7 shadow-lg">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-md shadow-primary/20">
            BT
          </span>
          <h1 className="text-xl font-semibold tracking-tight">BabulTech CRM</h1>
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
            <PasswordInput required />
          </Field>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
