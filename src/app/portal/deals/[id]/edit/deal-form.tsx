"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { formatMoney, humanize } from "@/lib/utils";
import { updatePartnerDeal, type PartnerDeal } from "@/server/partner-deals";

const TYPES = ["NEW", "RENEWAL", "UPSELL", "CROSS_SELL"];

/**
 * The deal's details, as our deal form has them - less the owner and campaign,
 * which are ours, and the stage, which moves on the deal's own page. Once the
 * deal has products and services its value is their total, so it is shown and
 * not edited here.
 */
export function PartnerDealForm({
  deal,
  currencies,
  leadSources,
}: {
  deal: PartnerDeal;
  currencies: { code: string; name: string }[];
  leadSources: { value: string; label: string }[];
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
      const result = await updatePartnerDeal(deal.id, {
        name: get("name"),
        primaryContactId: get("primaryContactId"),
        amount: deal.pricedByLines ? undefined : (get("amount") as never),
        currencyCode: get("currencyCode"),
        probabilityPercent: get("probabilityPercent") as never,
        expectedCloseDate: get("expectedCloseDate"),
        opportunityType: get("opportunityType"),
        leadSource: get("leadSource"),
        nextStep: get("nextStep"),
        competitorName: get("competitorName"),
        description: get("description"),
      });
      if (result.ok) {
        router.push(`/portal/deals/${deal.id}`);
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
            <Field label="Name" required error={fieldErrors.name?.[0]}>
              <Input name="name" required maxLength={255} defaultValue={deal.name} />
            </Field>
          </div>
          <Field label="Main contact" help="Who at the customer this deal is with.">
            <Select name="primaryContactId" defaultValue={deal.primaryContactId ?? ""}>
              <option value="">None</option>
              {deal.contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select name="opportunityType" defaultValue={deal.opportunityType ?? "NEW"}>
              {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </Select>
          </Field>
          {deal.pricedByLines ? (
            <Field label="Value" help="The total of the deal's products and services. Change those to change this.">
              <p className="py-2 text-sm font-medium">{formatMoney(deal.amount, deal.currencyCode)}</p>
            </Field>
          ) : (
            <Field label="Estimated value" error={fieldErrors.amount?.[0]}
              help="An estimate until you add products and services, whose total then replaces it.">
              <Input name="amount" type="number" min="0" step="0.01" defaultValue={String(Number(deal.amount))} />
            </Field>
          )}
          <Field label="Currency">
            <Select name="currencyCode" defaultValue={deal.currencyCode}>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} - {c.name}</option>)}
            </Select>
          </Field>
          <Field label="Expected close date" required error={fieldErrors.expectedCloseDate?.[0]}>
            <Input name="expectedCloseDate" type="date" required defaultValue={deal.expectedCloseDate?.slice(0, 10)} />
          </Field>
          <Field label="Probability %" error={fieldErrors.probabilityPercent?.[0]} hint="Set for you as the stage moves; change it if you know better.">
            <Input name="probabilityPercent" type="number" min="0" max="100" step="1"
              defaultValue={deal.probabilityPercent != null ? String(Number(deal.probabilityPercent)) : ""} />
          </Field>
          <Field label="Lead source">
            <Select name="leadSource" defaultValue={deal.leadSource ?? ""}>
              <option value="">Not stated</option>
              {leadSources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              {deal.leadSource && !leadSources.some((s) => s.value === deal.leadSource) && (
                <option value={deal.leadSource}>{deal.leadSource}</option>
              )}
            </Select>
          </Field>
          <Field label="Competitor">
            <Input name="competitorName" maxLength={200} defaultValue={deal.competitorName ?? ""} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Next step">
              <Input name="nextStep" maxLength={500} defaultValue={deal.nextStep ?? ""} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea name="description" rows={4} maxLength={8000} defaultValue={deal.description ?? ""} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  );
}
