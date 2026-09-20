"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
} from "@/components/ui";
import { addPartnerContact } from "@/server/partner-customers";

export function AddContactForm({
  accountId,
  accountName,
}: {
  accountId: string;
  accountName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});

    start(async () => {
      const result = await addPartnerContact({
        accountId,
        firstName: String(fd.get("firstName") ?? ""),
        lastName: String(fd.get("lastName") ?? ""),
        email: String(fd.get("email") ?? ""),
        phone: String(fd.get("phone") ?? ""),
        jobTitle: String(fd.get("jobTitle") ?? ""),
      });

      if (result.ok) {
        router.push("/portal/customers");
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Their details</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Added to {accountName}. Only you and our team will see them.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName?.[0]}>
            <Input id="firstName" name="firstName" required maxLength={100} />
          </Field>
          <Field label="Last name" required error={fieldErrors.lastName?.[0]}>
            <Input id="lastName" name="lastName" required maxLength={100} />
          </Field>
          <Field label="Job title">
            <Input id="jobTitle" name="jobTitle" maxLength={150} />
          </Field>
          <Field label="Email" error={fieldErrors.email?.[0]}>
            <Input id="email" name="email" type="email" maxLength={255} />
          </Field>
          <Field label="Phone">
            <Input id="phone" name="phone" maxLength={50} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add employee"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/portal/customers")} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
