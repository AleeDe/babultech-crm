"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setPasswordWithLink } from "@/server/password-links";
import { Alert, Button, Field } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export function ResetForm({ token, email }: { token: string; email: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ active: boolean } | null>(null);

  function submit(form: FormData) {
    setError(null);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError("The two passwords do not match.");
      return;
    }
    start(async () => {
      const result = await setPasswordWithLink(token, password);
      if (result.ok) setDone({ active: result.data.active });
      else setError(result.error);
    });
  }

  if (done) {
    return (
      <div className="space-y-4 text-center text-sm">
        <Alert tone="success">Your password is set.</Alert>
        <p className="text-muted-foreground">
          Sign in with <span className="font-medium text-foreground">{email}</span> and your new password.
          {done.active ? "" : " Your login is not switched on yet; it opens on your start date."}
        </p>
        <Link href="/login" className="inline-block font-medium text-primary hover:underline">Go to sign in</Link>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-4">
      <p className="text-center text-sm text-muted-foreground">
        Your sign-in email is <span className="font-medium text-foreground">{email}</span>. Choose a password for it.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="New password" required hint="At least 10 characters, upper and lower case and a number.">
        <PasswordInput name="password" autoComplete="new-password" required />
      </Field>
      <Field label="Confirm password" required>
        <PasswordInput name="confirm" autoComplete="new-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
