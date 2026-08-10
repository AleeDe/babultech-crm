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

  function onSubmit(formData: FormData) {
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
    <form action={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Organisation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Account name" required error={fieldErrors.name?.[0]}>
            <Input name="name" required defaultValue={defaults?.name} placeholder="Acme (Pvt) Ltd" />
          </Field>
          <Field label="Account type" required hint="Setting this to Partner is what allows a partner record against it.">
            <Select name="accountType" required defaultValue={defaults?.accountType ?? "PROSPECT"}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" required error={fieldErrors.ownerUserId?.[0]}>
            <Select name="ownerUserId" required defaultValue={defaults?.ownerUserId ?? currentUserId}>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Parent account" hint="For subsidiaries and group companies.">
            <Select name="parentAccountId" defaultValue={defaults?.parentAccountId ?? ""}>
              <option value="">None</option>
              {options.accounts
                .filter((a) => a.id !== defaults?.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
            </Select>
          </Field>
          <Field label="Industry">
            <Input name="industry" defaultValue={defaults?.industry ?? ""} placeholder="Manufacturing" />
          </Field>
          <Field label="Main phone">
            <Input name="mainPhone" defaultValue={defaults?.mainPhone ?? ""} placeholder="+92 42 1234567" />
          </Field>
          <Field label="Website">
            <Input name="website" defaultValue={defaults?.website ?? ""} placeholder="https://" />
          </Field>
          <Field label="Tax number / NTN">
            <Input name="taxNumberNtn" defaultValue={defaults?.taxNumberNtn ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer standing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer status" hint="Only meaningful once they are a customer.">
            <Select name="customerStatus" defaultValue={defaults?.customerStatus ?? ""}>
              <option value="">Not set</option>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Health">
            <Select name="customerHealth" defaultValue={defaults?.customerHealth ?? ""}>
              <option value="">Not set</option>
              {HEALTH.map((h) => (
                <option key={h} value={h}>{humanize(h)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Credit limit">
            <Input
              name="creditLimit"
              type="number"
              step="0.01"
              min="0"
              defaultValue={defaults?.creditLimit ?? ""}
            />
          </Field>
          <Field label="Payment terms (days)">
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
          <Field label="Address line 1">
            <Input name="line1" defaultValue={address.line1 ?? ""} />
          </Field>
          <Field label="Address line 2">
            <Input name="line2" defaultValue={address.line2 ?? ""} />
          </Field>
          <Field label="City">
            <Input name="city" defaultValue={address.city ?? ""} />
          </Field>
          <Field label="Province / state">
            <Input name="state" defaultValue={address.state ?? ""} />
          </Field>
          <Field label="Postal code">
            <Input name="postalCode" defaultValue={address.postalCode ?? ""} />
          </Field>
          <Field label="Country">
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
