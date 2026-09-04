import { redirect } from "next/navigation";
import { signInWithCredentials } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { Button, Card, Field, Input, Alert } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Only asking "is anyone signed in?", so verify the token locally against the
  // cached JWKS rather than spending a round trip on the answer.
  const db = await supabaseServer();
  const { data: claims } = await db.auth.getClaims();
  if (claims) redirect("/");

  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const result = await signInWithCredentials(
      String(formData.get("email") ?? ""),
      String(formData.get("password") ?? ""),
    );

    // redirect() throws, so it must sit outside any try/catch that would
    // swallow the control-flow exception.
    if (!result.ok) redirect(`/login?error=${result.reason}`);
    redirect("/");
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-muted/40 p-4">
      {/* Two soft washes behind the card. Decorative only - the form reads the
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
            <Alert tone="danger">
              {error === "inactive"
                ? "That account is not active. Contact an administrator."
                : "That email and password combination did not work."}
            </Alert>
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
