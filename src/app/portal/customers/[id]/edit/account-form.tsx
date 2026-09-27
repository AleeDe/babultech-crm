"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { humanize } from "@/lib/utils";
import { updatePartnerAccount } from "@/server/partner-deals";

interface AccountValues {
  id: string;
  name: string;
  industry: string;
  website: string;
  mainPhone: string;
  employeeCount: string;
  description: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/**
 * The company details of an account the partner brought us. Its type, status
 * and internal owner are ours and are not here. A new name that matches a
 * company we already know is flagged for us to look at.
 */
export function PartnerAccountForm({
  account,
  industries,
}: {
  account: AccountValues;
  industries: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "");
    setError(null);
    setFieldErrors({});
    start(async () => {
      const result = await updatePartnerAccount(account.id, {
        name: get("name"),
        industry: get("industry"),
        website: get("website"),
        mainPhone: get("mainPhone"),
        employeeCount: get("employeeCount") as never,
        description: get("description"),
        billingAddress: {
          street: get("street"), city: get("city"), state: get("state"),
          postalCode: get("postalCode"), country: get("country"),
        },
      });
      if (result.ok) {
        router.push(`/portal/customers/${account.id}`);
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
          <CardTitle>Company</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Name" required error={fieldErrors.name?.[0]}>
              <Input name="name" required maxLength={200} defaultValue={account.name} />
            </Field>
          </div>
          <Field label="Industry">
            <Select name="industry" defaultValue={account.industry}>
              <option value="">Not stated</option>
              {industries.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
              {account.industry && !industries.some((i) => i.value === account.industry) && (
                <option value={account.industry}>{humanize(account.industry)}</option>
              )}
            </Select>
          </Field>
          <Field label="Employees">
            <Input name="employeeCount" type="number" min="0" step="1" defaultValue={account.employeeCount} />
          </Field>
          <Field label="Main phone"><Input name="mainPhone" maxLength={50} defaultValue={account.mainPhone} /></Field>
          <Field label="Website"><Input name="website" maxLength={255} defaultValue={account.website} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Address</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street"><Input name="street" maxLength={255} defaultValue={account.street} /></Field>
          </div>
          <Field label="City"><Input name="city" maxLength={100} defaultValue={account.city} /></Field>
          <Field label="State or province"><Input name="state" maxLength={100} defaultValue={account.state} /></Field>
          <Field label="Postal code"><Input name="postalCode" maxLength={30} defaultValue={account.postalCode} /></Field>
          <Field label="Country"><Input name="country" maxLength={100} defaultValue={account.country} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="About this account">
            <Textarea name="description" rows={4} maxLength={8000} defaultValue={account.description} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  );
}
