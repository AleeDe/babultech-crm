"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContact, updateContact } from "@/server/crm";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Alert,
} from "@/components/ui";
import { PicklistSelect } from "@/components/picklist-select";
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

  // A submit HANDLER rather than <form action={...}>. React resets a form after
  // an action completes, and every field here is uncontrolled (defaultValue), so
  // with `action` a rejected submit cleared everything the user had typed and
  // made them fill the whole form in again to correct one field.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

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
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      {isPartnerPerson && (
        <Alert tone="info">
          This contact is an individual partner. It stays independent of any company account,
          that is what keeps a freelance referrer out of your customer list.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Person</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName?.[0]}
            help="Their given name.">
            <Input name="firstName" required defaultValue={defaults?.firstName} />
          </Field>
          <Field label="Last name" required error={fieldErrors.lastName?.[0]}
            help="Their family name.">
            <Input name="lastName" required defaultValue={defaults?.lastName} />
          </Field>

          {!isPartnerPerson && !lockedAccountId && (
            <Field
              label="Company"
              hint="Leave blank for an independent person - a contact does not need an account."
            help="The account they work for. A contact always belongs to one."
            >
              <Select name="accountId" defaultValue={defaults?.accountId ?? ""}>
                <option value="">Independent - no company</option>
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Job title"
            help="Their role, which is your best guide to how much say they have.">
            <Input name="jobTitle" defaultValue={defaults?.jobTitle ?? ""} />
          </Field>
          <Field label="Department"
            help="Which part of the business they sit in.">
            <Input name="department" defaultValue={defaults?.department ?? ""} />
          </Field>
          <Field label="Buying role" hint="Decision maker, influencer, technical evaluator…"
            help="Their part in the purchase - decision maker, influencer, the person who signs. Worth being honest about.">
            <Input name="contactRole" defaultValue={defaults?.contactRole ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reaching them</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" error={fieldErrors.email?.[0]}
            help="Their work email. Quotations and invoices go here.">
            <Input name="email" type="email" defaultValue={defaults?.email ?? ""} />
          </Field>
          <Field label="Phone"
            help="Their desk or landline number.">
            <Input name="phone" defaultValue={defaults?.phone ?? ""} />
          </Field>
          <Field label="Mobile"
            help="Their direct mobile.">
            <Input name="mobile" defaultValue={defaults?.mobile ?? ""} placeholder="+92 300 1234567" />
          </Field>
          <Field label="WhatsApp"
            help="Only if it differs from the mobile above.">
            <Input name="whatsapp" defaultValue={defaults?.whatsapp ?? ""} />
          </Field>
          <Field label="Preferred channel"
            help="How they would rather be contacted. Following it gets faster replies.">
            <PicklistSelect list="preferred_channel" name="preferredChannel" emptyLabel="Not stated" fallback={CHANNELS} defaultValue={defaults?.preferredChannel ?? ""} addLabel="Add a channel" />
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
