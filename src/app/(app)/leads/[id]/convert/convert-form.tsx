"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertLead } from "@/server/crm";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Alert,
} from "@/components/ui";

interface Options {
  accounts: { id: string; name: string }[];
}

export function ConvertForm({
  leadId,
  leadLabel,
  suggestedName,
  suggestedAmount,
  referredByPartnerName,
  options,
}: {
  leadId: string;
  leadLabel: string;
  suggestedName: string;
  suggestedAmount: string | null;
  referredByPartnerName: string | null;
  options: Options;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [useExisting, setUseExisting] = useState(false);

  function onSubmit(formData: FormData) {
    setError(null);

    // convertSchema uses .optional() (not .nullable()) for these, so empty
    // values must be undefined rather than null.
    const opt = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? undefined : String(v);
    };

    startTransition(async () => {
      const result = await convertLead({
        leadId,
        accountId: useExisting ? (opt("accountId") ?? null) : null,
        createOpportunity,
        opportunityName: createOpportunity ? opt("opportunityName") : undefined,
        amount: createOpportunity ? opt("amount") : undefined,
        expectedCloseDate: createOpportunity ? opt("expectedCloseDate") : undefined,
      } as never);

      if (result.ok) {
        router.push(
          result.data.opportunityId
            ? `/opportunities/${result.data.opportunityId}`
            : `/accounts/${result.data.accountId}`,
        );
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Alert tone="info">
        Converting {leadLabel} creates a contact, an account and (optionally) a deal, then locks
        the lead as read-only.
        {referredByPartnerName && (
          <>
            {" "}
            <strong>{referredByPartnerName}</strong> referred this lead and will be attached to the
            new deal as Sourced, so commission accrues automatically.
          </>
        )}
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useExisting}
              onChange={(e) => setUseExisting(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            This company already exists — attach to an existing account instead of creating one
          </label>

          {useExisting ? (
            <Field label="Existing account" required
            help="Link to a company already in the system instead of creating a duplicate. Check here first — duplicate accounts are hard to merge later.">
              <Select name="accountId" required>
                <option value="">Select an account…</option>
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">
              A new prospect account will be created as <strong>{suggestedName}</strong>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Opportunity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createOpportunity}
              onChange={(e) => setCreateOpportunity(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Create an opportunity from this lead
          </label>

          {createOpportunity && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Deal name"
            help="What the resulting opportunity is called.">
                <Input name="opportunityName" defaultValue={`${suggestedName} — new business`} />
              </Field>
              <Field label="Amount" hint="Defaults to the lead's estimated value."
            help="What you expect the deal to be worth.">
                <Input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={suggestedAmount ?? ""}
                />
              </Field>
              <Field label="Expected close date" hint="Defaults to 60 days out."
            help="When you expect a decision. Drives the forecast from the moment the lead converts.">
                <Input name="expectedCloseDate" type="date" />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Converting…" : "Convert lead"}
        </Button>
      </div>
    </form>
  );
}
