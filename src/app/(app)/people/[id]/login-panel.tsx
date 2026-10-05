"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";
import { createLoginForPerson } from "@/server/people";
import { humanize } from "@/lib/utils";

/**
 * Their CRM login: who it is, or - for an administrator - a form to create it
 * from the contract. Everyone hired gets one, to record their time.
 */
export function LoginPanel({ staffId, user, canCreateLogins, hasContract }: {
  staffId: string;
  user: { id: string; fullName: string; email: string; status: string; role: { name: string } | null } | null;
  canCreateLogins: boolean;
  hasContract: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(form: FormData) {
    setError(null);
    start(async () => {
      const result = await createLoginForPerson(staffId, { email: String(form.get("loginEmail")), password: String(form.get("loginPassword")) });
      if (!result.ok) { setError(result.error); return; }
      window.location.reload();
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>CRM login</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {user ? (
          <>
            <p className="flex flex-wrap items-center gap-2">
              {canCreateLogins ? <Link href={`/users/${user.id}`} className="font-medium hover:underline">{user.email}</Link> : <span className="font-medium">{user.email}</span>}
              <Badge tone={user.status === "ACTIVE" ? "success" : "neutral"}>{humanize(user.status)}</Badge>
            </p>
            <p className="text-muted-foreground">Role: {user.role?.name ?? "—"}</p>
            <p className="text-xs text-muted-foreground">Switched off automatically the day after their last contract ends, and back on when a new one starts.</p>
          </>
        ) : !canCreateLogins ? (
          <p className="text-muted-foreground">No login yet. An administrator creates it from this page.</p>
        ) : !hasContract ? (
          <p className="text-muted-foreground">Prepare a contract first; the login is set up from it.</p>
        ) : !open ? (
          <>
            <p className="text-muted-foreground">No login yet. It gets the role, job title, manager and teams on their contract. If the contract starts later, the login waits until then.</p>
            <Button type="button" onClick={() => setOpen(true)}>Create login</Button>
          </>
        ) : (
          <form action={submit} className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Work email" required hint="What they sign in with."><Input name="loginEmail" type="email" required /></Field>
            <Field label="Temporary password" required hint="At least 10 characters, upper and lower case and a number. They change it under My account.">
              <PasswordInput name="loginPassword" autoComplete="new-password" required />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create login"}</Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
