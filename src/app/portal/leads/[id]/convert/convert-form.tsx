"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@/components/ui";
import { SaveError } from "@/components/save-error";
import type { DuplicateRef } from "@/lib/duplicates";
import { convertPartnerLead } from "@/server/partner-leads";

/**
 * A lead becomes an account, its contact and - if there is a sale in sight - a
 * deal, all credited to the partner. The deal gets its commission record at
 * the partner's rate from the moment it exists.
 */
export function PartnerConvertForm({
  leadId,
  company,
  suggestedAmount,
}: {
  leadId: string;
  company: string;
  suggestedAmount: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateRef | undefined>();
  const [withDeal, setWithDeal] = useState(true);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setDuplicate(undefined);
    start(async () => {
      const result = await convertPartnerLead({
        leadId,
        createOpportunity: withDeal,
        opportunityName: withDeal ? String(form.get("opportunityName") ?? "") : "",
        amount: withDeal ? (String(form.get("amount") ?? "") as never) : undefined,
        expectedCloseDate: withDeal ? String(form.get("expectedCloseDate") ?? "") : "",
      });
      if (!result.ok) {
        setError(result.error);
        setDuplicate(result.duplicate);
        return;
      }
      // The account page shows the new contact and deal together.
      router.push(`/portal/customers/${result.data.accountId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <SaveError error={error} duplicate={duplicate} />

      <Alert tone="info">
        Converting creates the account <strong>{company}</strong> and its contact, credited to you,
        and locks the lead as the record of how they arrived. Your partner manager looks after the
        account with you.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Opportunity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withDeal}
              onChange={(e) => setWithDeal(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Open a deal as well - your commission record starts with it
          </label>
          {withDeal && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Deal name">
                  <Input name="opportunityName" maxLength={255} defaultValue={`${company} - new business`} />
                </Field>
              </div>
              <Field label="Amount" hint="Replaced by its products and services once you add them.">
                <Input name="amount" type="number" min="0" step="0.01" defaultValue={suggestedAmount} />
              </Field>
              <Field label="Expected close date" hint="Defaults to 30 days from today.">
                <Input name="expectedCloseDate" type="date" />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Converting…" : "Convert lead"}</Button>
      </div>
    </form>
  );
}
