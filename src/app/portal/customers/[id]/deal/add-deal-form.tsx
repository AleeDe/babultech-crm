"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea,
} from "@/components/ui";
import { addPartnerOpportunity } from "@/server/partner-customers";

export function AddDealForm({
  accountId,
  contacts,
  currencies,
}: {
  accountId: string;
  contacts: { id: string; firstName: string; lastName: string; jobTitle: string | null }[];
  currencies: { code: string; name: string }[];
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
      const result = await addPartnerOpportunity({
        accountId,
        name: String(fd.get("name") ?? ""),
        amount: fd.get("amount") ? Number(fd.get("amount")) : undefined,
        closeDate: String(fd.get("closeDate") ?? ""),
        currencyCode: String(fd.get("currencyCode") ?? "PKR"),
        contactId: String(fd.get("contactId") ?? ""),
        notes: String(fd.get("notes") ?? ""),
      });

      if (result.ok) {
        router.push("/portal/deals");
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
          <CardTitle>The deal</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What are you selling them?" required error={fieldErrors.name?.[0]}>
              <Input id="name" name="name" required minLength={2} maxLength={255} placeholder="Mobile app build" />
            </Field>
          </div>
          <Field label="Expected value" help="Your best estimate. It can change as the deal develops.">
            <Input id="amount" name="amount" type="number" min="0" step="0.01" />
          </Field>
          <Field label="Currency">
            <Select id="currencyCode" name="currencyCode" defaultValue="PKR">
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Expected close date" help="Leave blank and we will assume 30 days.">
            <Input id="closeDate" name="closeDate" type="date" />
          </Field>
          <Field label="Who is the buyer?" help="The person at the customer who decides.">
            <Select id="contactId" name="contactId" defaultValue="">
              <option value="">Not sure yet</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                  {c.jobTitle ? ` — ${c.jobTitle}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes" help="What they need, what stage you are at, anything we should know before we speak to them.">
              <Textarea id="notes" name="notes" rows={3} maxLength={2000} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create deal"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/portal/customers")} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
