"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContact, updateContact } from "@/server/crm";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Alert,
} from "@/components/ui";
import { humanize } from "@/lib/utils";

const CHANNELS = ["EMAIL", "PHONE", "WHATSAPP"];

interface Options {
  accounts: { id: string; name: string }[];
}

export interface ContactDefaults {
  id: string;
  accountId: string | null;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp: string | null;
  contactRole: string | null;
  isPrimary: boolean;
  preferredChannel: string | null;
  communicationConsent: boolean;
  /** Set when this contact backs an individual partner — accountId is then locked. */
  partnerId: string | null;
}

export function ContactForm({
  options,
  defaults,
  lockedAccountId,
}: {
  options: Options;
  defaults?: ContactDefaults;
  lockedAccountId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const editing = Boolean(defaults);
  const isPartnerPerson = Boolean(defaults?.partnerId);

  function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const input = {
      accountId: isPartnerPerson ? null : (lockedAccountId ?? get("accountId")),
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      jobTitle: get("jobTitle"),
      department: get("department"),
      email: get("email") ?? "",
      phone: get("phone"),
      mobile: get("mobile"),
      whatsapp: get("whatsapp"),
      contactRole: get("contactRole"),
      isPrimary: formData.get("isPrimary") === "on",
      preferredChannel: get("preferredChannel") as never,
      communicationConsent: formData.get("communicationConsent") === "on",
    } as never;

    startTransition(async () => {
      const result = defaults
        ? await updateContact(defaults.id, input)
        : await createContact(input);

      if (result.ok) {
        router.push("/contacts");
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      {isPartnerPerson && (
        <Alert tone="info">
          This contact is an individual partner. It stays independent of any company account —
          that is what keeps a freelance referrer out of your customer list.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Person</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName?.[0]}>
            <Input name="firstName" required defaultValue={defaults?.firstName} />
          </Field>
          <Field label="Last name" required error={fieldErrors.lastName?.[0]}>
            <Input name="lastName" required defaultValue={defaults?.lastName} />
          </Field>

          {!isPartnerPerson && !lockedAccountId && (
            <Field
              label="Company"
              hint="Leave blank for an independent person — a contact does not need an account."
            >
              <Select name="accountId" defaultValue={defaults?.accountId ?? ""}>
                <option value="">Independent — no company</option>
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Job title">
            <Input name="jobTitle" defaultValue={defaults?.jobTitle ?? ""} />
          </Field>
          <Field label="Department">
            <Input name="department" defaultValue={defaults?.department ?? ""} />
          </Field>
          <Field label="Buying role" hint="Decision maker, influencer, technical evaluator…">
            <Input name="contactRole" defaultValue={defaults?.contactRole ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reaching them</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" error={fieldErrors.email?.[0]}>
            <Input name="email" type="email" defaultValue={defaults?.email ?? ""} />
          </Field>
          <Field label="Phone">
            <Input name="phone" defaultValue={defaults?.phone ?? ""} />
          </Field>
          <Field label="Mobile">
            <Input name="mobile" defaultValue={defaults?.mobile ?? ""} placeholder="+92 300 1234567" />
          </Field>
          <Field label="WhatsApp">
            <Input name="whatsapp" defaultValue={defaults?.whatsapp ?? ""} />
          </Field>
          <Field label="Preferred channel">
            <Select name="preferredChannel" defaultValue={defaults?.preferredChannel ?? ""}>
              <option value="">Not stated</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{humanize(c)}</option>
              ))}
            </Select>
          </Field>
          <div className="space-y-3 pt-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="communicationConsent"
                defaultChecked={defaults?.communicationConsent ?? false}
                className="h-4 w-4 rounded border-input"
              />
              Has consented to marketing contact
            </label>
            {!isPartnerPerson && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="isPrimary"
                  defaultChecked={defaults?.isPrimary ?? false}
                  className="h-4 w-4 rounded border-input"
                />
                Primary contact for this company
              </label>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create contact"}
        </Button>
      </div>
    </form>
  );
}
