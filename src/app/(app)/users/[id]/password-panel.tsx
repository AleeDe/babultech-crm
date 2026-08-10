"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUserPassword } from "@/server/users";
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Alert } from "@/components/ui";

/** Administrator-side password reset. The current password is not required — an
 *  admin resetting an account is a different act from a user changing theirs. */
export function PasswordPanel({ userId, fullName }: { userId: string; fullName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    setNotice(null);
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    startTransition(async () => {
      const result = await setUserPassword(userId, password);
      if (result.ok) {
        setNotice(`Password set. Tell ${fullName.split(" ")[0]} to sign in with it and change it.`);
        setOpen(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {open ? (
          <form action={submit} className="space-y-3">
            <Field label="New password" hint="At least 10 characters, mixed case, with a number.">
              <Input name="password" type="password" required autoComplete="new-password" />
            </Field>
            <Field label="Confirm">
              <Input name="confirm" type="password" required autoComplete="new-password" />
            </Field>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Setting…" : "Set password"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Resetting is recorded in the audit trail. The new password is not shown again, so pass
              it on directly.
            </p>
            <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
              Reset password
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
