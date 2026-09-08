"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { createAccount, updateAccount } from "@/server/crm";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { humanize } from "@/lib/utils";

const ACCOUNT_TYPES = ["PROSPECT", "CUSTOMER", "PARTNER", "VENDOR", "COMPETITOR", "OTHER"];
const CUSTOMER_STATUSES = ["ONBOARDING", "ACTIVE", "AT_RISK", "CHURNED"];
const HEALTH = ["GREEN", "AMBER", "RED"];

interface Options {
  users: { id: string; fullName: string }[];
  accounts: { id: string; name: string; accountType: string }[];
}

export interface AccountDefaults {
  id: string;
  name: string;
  accountType: string;
  customerStatus: string | null;
  parentAccountId: string | null;
  ownerUserId: string;
  industry: string | null;
  website: string | null;
  mainPhone: string | null;
  taxNumberNtn: string | null;
  creditLimit: string | null;
  paymentTermsDays: number | null;
  customerHealth: string | null;
  description: string | null;
  billingAddress: Record<string, string> | null;
}

export function AccountForm({
  options,
  defaults,
  currentUserId,
}: {
  options: Options;
  defaults?: AccountDefaults;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const editing = Boolean(defaults);
  const address = defaults?.billingAddress ?? {};

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

    const billing: Record<string, string> = {};
    for (const key of ["line1", "line2", "city", "state", "postalCode", "country"]) {
      const value = get(key);
      if (value) billing[key] = value;
    }

    const input = {
      name: String(formData.get("name") ?? ""),
      accountType: get("accountType") as never,
      customerStatus: get("customerStatus") as never,
      parentAccountId: get("parentAccountId"),
      ownerUserId: String(formData.get("ownerUserId") ?? ""),
      industry: get("industry"),
      website: get("website"),
      mainPhone: get("mainPhone"),
      taxNumberNtn: get("taxNumberNtn"),
      creditLimit: get("creditLimit"),
      paymentTermsDays: get("paymentTermsDays"),
      customerHealth: get("customerHealth") as never,
      description: get("description"),
      billingAddress: Object.keys(billing).length > 0 ? billing : null,
    } as never;

    startTransition(async () => {
      const result = defaults
        ? await updateAccount(defaults.id, input)
        : await createAccount(input);

      if (result.ok) {
        router.push(`/accounts/${result.data.id}`);
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
          <CardTitle>Organisation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Account name" required error={fieldErrors.name?.[0]}
            help="The organisation's registered business name, as it should appear on a quotation or invoice.">
            <Input name="name" required defaultValue={defaults?.name} placeholder="Acme (Pvt) Ltd" />
          </Field>
          <Field label="Account type" required hint="Setting this to Partner is what allows a partner record against it."
            help="Whether this is a prospect you are selling to, an existing customer, a partner or a supplier. It decides where the account shows up.">
            <Select name="accountType" required defaultValue={defaults?.accountType ?? "PROSPECT"}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" required error={fieldErrors.ownerUserId?.[0]}
            help="Whoever holds this relationship. They see the account in their own list, and it counts towards their pipeline.">
            <Select name="ownerUserId" required defaultValue={defaults?.ownerUserId ?? currentUserId}>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Parent account" hint="For subsidiaries and group companies."
            help="Set this when the account is a subsidiary or branch of another one already in the system. Leave it empty otherwise.">
            <Select name="parentAccountId" defaultValue={defaults?.parentAccountId ?? ""}>
              <option value="">None</option>
              {options.accounts
                .filter((a) => a.id !== defaults?.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
            </Select>
          </Field>
          <Field label="Industry"
            help="The sector they operate in. Used for reporting and for finding similar customers.">
            <Input name="industry" defaultValue={defaults?.industry ?? ""} placeholder="Manufacturing" />
          </Field>
          <Field label="Main phone"
            help="The company's general number, not a personal mobile. Contacts hold individual numbers.">
            <Input name="mainPhone" defaultValue={defaults?.mainPhone ?? ""} placeholder="+92 42 1234567" />
          </Field>
          <Field label="Website"
            help="Their public site. Include https:// so the link works from the record.">
            <Input name="website" defaultValue={defaults?.website ?? ""} placeholder="https://" />
          </Field>
          <Field label="Tax number / NTN"
            help="The National Tax Number. It is required on their invoices, so it is worth capturing before you raise the first one.">
            <Input name="taxNumberNtn" defaultValue={defaults?.taxNumberNtn ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer standing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer status" hint="Only meaningful once they are a customer."
            help="For customers only: how healthy the relationship is - onboarding, active, at risk, or gone.">
            <Select name="customerStatus" defaultValue={defaults?.customerStatus ?? ""}>
              <option value="">Not set</option>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Health"
            help="A traffic light for how the relationship is going. Amber and red are worth a conversation well before renewal.">
            <Select name="customerHealth" defaultValue={defaults?.customerHealth ?? ""}>
              <option value="">Not set</option>
              {HEALTH.map((h) => (
                <option key={h} value={h}>{humanize(h)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Credit limit"
            help="The most you are willing to have outstanding with them at any one time.">
            <Input
              name="creditLimit"
              type="number"
              step="0.01"
              min="0"
              defaultValue={defaults?.creditLimit ?? ""}
            />
          </Field>
          <Field label="Payment terms (days)"
            help="How long after invoicing they are allowed to pay. 30 is the usual default.">
            <Input
              name="paymentTermsDays"
              type="number"
              min="0"
              defaultValue={defaults?.paymentTermsDays ?? ""}
              placeholder="30"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing address</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1"
            help="Street address. This is what prints on their invoices, so use the billing address rather than a site office.">
            <Input name="line1" defaultValue={address.line1 ?? ""} />
          </Field>
          <Field label="Address line 2"
            help="Suite, floor or building name, if there is one.">
            <Input name="line2" defaultValue={address.line2 ?? ""} />
          </Field>
          <Field label="City"
            help="City for the billing address above.">
            <Input name="city" defaultValue={address.city ?? ""} />
          </Field>
          <Field label="Province / state"
            help="Province or state. Sindh, Punjab and so on for Pakistani customers.">
            <Input name="state" defaultValue={address.state ?? ""} />
          </Field>
          <Field label="Postal code"
            help="Postal or ZIP code for the billing address.">
            <Input name="postalCode" defaultValue={address.postalCode ?? ""} />
          </Field>
          <Field label="Country"
            help="Country for the billing address. Affects nothing automatically, but appears on documents.">
            <Input name="country" defaultValue={address.country ?? "Pakistan"} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea name="description" rows={4} defaultValue={defaults?.description ?? ""} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
