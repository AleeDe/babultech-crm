"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@/components/ui";
import { SaveError } from "@/components/save-error";
import type { DuplicateRef } from "@/lib/duplicates";
import { savePartnerContact, type PartnerContact } from "@/server/partner-deals";

/**
 * One of the people at an account the partner brought us. Somebody already in
 * our records cannot be given this person's email or numbers; the partner is
 * told only that they are known, unless the record is their own.
 */
export function PartnerContactForm({ accountId, contact }: { accountId: string; contact: PartnerContact }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [duplicate, setDuplicate] = useState<DuplicateRef | undefined>();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "");
    setError(null);
    setFieldErrors({});
    setDuplicate(undefined);
    start(async () => {
      const result = await savePartnerContact(contact.id, accountId, {
        firstName: get("firstName"),
        lastName: get("lastName"),
        jobTitle: get("jobTitle"),
        department: get("department"),
        email: get("email"),
        phone: get("phone"),
        mobile: get("mobile"),
        whatsapp: get("whatsapp"),
        isPrimary: form.get("isPrimary") === "on",
      });
      if (result.ok) {
        router.push(`/portal/customers/${accountId}`);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        setDuplicate(result.duplicate);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <SaveError error={error} duplicate={duplicate} />
      <Card>
        <CardHeader>
          <CardTitle>Their details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName?.[0]}>
            <Input name="firstName" required maxLength={100} defaultValue={contact.firstName} />
          </Field>
          <Field label="Last name" required error={fieldErrors.lastName?.[0]}>
            <Input name="lastName" required maxLength={100} defaultValue={contact.lastName} />
          </Field>
          <Field label="Job title"><Input name="jobTitle" maxLength={150} defaultValue={contact.jobTitle ?? ""} /></Field>
          <Field label="Department"><Input name="department" maxLength={100} defaultValue={contact.department ?? ""} /></Field>
          <Field label="Email" error={fieldErrors.email?.[0]}>
            <Input name="email" type="email" maxLength={255} defaultValue={contact.email ?? ""} />
          </Field>
          <Field label="Phone" error={fieldErrors.phone?.[0]}><Input name="phone" maxLength={50} defaultValue={contact.phone ?? ""} /></Field>
          <Field label="Mobile" error={fieldErrors.mobile?.[0]}><Input name="mobile" maxLength={50} defaultValue={contact.mobile ?? ""} /></Field>
          <Field label="WhatsApp" error={fieldErrors.whatsapp?.[0]}><Input name="whatsapp" maxLength={50} defaultValue={contact.whatsapp ?? ""} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="isPrimary" defaultChecked={contact.isPrimary} className="h-4 w-4 rounded border-input" />
            The main person we deal with at this account
          </label>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  );
}
