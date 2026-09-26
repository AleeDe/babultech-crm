"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOpportunity, updateOpportunity } from "@/server/opportunities";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { RecordLookup } from "@/components/record-lookup";
import { PicklistOptions } from "@/components/picklist";
import { PicklistSelect } from "@/components/picklist-select";
import { formatMoney } from "@/lib/utils";

const STAGES = [
  "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
  "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION", "ON_HOLD",
];
const TYPES = ["NEW", "RENEWAL", "UPSELL", "CROSS_SELL"];

/** Exported so the pages can cast `serialize()`'s output. */
export interface OpportunityFormOptions {
  users: { id: string; fullName: string }[];
  accounts: { id: string; name: string }[];
  contacts: { id: string; firstName: string; lastName: string; accountId: string | null }[];
  campaigns: { id: string; name: string }[];
  currencies: { code: string; name: string }[];
}

export interface OpportunityDefaults {
  id: string;
  name: string;
  accountId: string;
  primaryContactId: string | null;
  ownerUserId: string;
  campaignId: string | null;
  amount: string;
  currencyCode: string;
  probabilityPercent: string;
  expectedCloseDate: string;
  opportunityType: string;
  leadSource: string | null;
  nextStep: string | null;
  description: string | null;
  /** True once the deal has products and services: its amount is then theirs. */
  pricedByLines: boolean;
}

/**
 * A deal's details.
 *
 * What it SELLS is not here. Products and services are added on the deal's own
 * page, with Add Product & Service, which chooses the price book and prices
 * each line; the deal has to exist first for its lines to belong to it. Once it
 * has lines, the amount below is their total and cannot be typed over.
 */
export function OpportunityForm({
  options,
  defaults,
  currentUserId,
  lockedAccountId,
}: {
  options: OpportunityFormOptions;
  defaults?: OpportunityDefaults;
  currentUserId: string;
  lockedAccountId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [accountId, setAccountId] = useState(defaults?.accountId ?? lockedAccountId ?? "");
  const [currencyCode, setCurrencyCode] = useState(defaults?.currencyCode ?? "PKR");
  const [amount, setAmount] = useState(defaults?.amount ?? "");
  const [primaryContactId, setPrimaryContactId] = useState(defaults?.primaryContactId ?? "");

  const editing = Boolean(defaults);
  const priced = Boolean(defaults?.pricedByLines);

  // A submit HANDLER rather than <form action={...}>. React resets a form after
  // an action completes, and the fields here are uncontrolled, so with `action`
  // a rejected submit cleared everything the user had typed.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const base = {
      name: String(formData.get("name") ?? ""),
      accountId,
      primaryContactId: primaryContactId || null,
      ownerUserId: String(formData.get("ownerUserId") ?? ""),
      campaignId: get("campaignId"),
      amount: amount === "" ? 0 : amount,
      currencyCode,
      probabilityPercent: get("probabilityPercent"),
      expectedCloseDate: get("expectedCloseDate"),
      opportunityType: get("opportunityType"),
      leadSource: get("leadSource"),
      nextStep: get("nextStep"),
      description: get("description"),
    };

    startTransition(async () => {
      const result = defaults
        ? await updateOpportunity(defaults.id, base as never)
        : await createOpportunity({ ...base, stage: get("stage") } as never);

      if (result.ok) {
        router.push(`/opportunities/${result.data.id}`);
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
          <Field label="Deal name" required error={fieldErrors.name?.[0]}
            help="What this deal is, in a few words. Something like 'SmartPOS - 12 tills' beats the customer name repeated.">
            <Input name="name" required defaultValue={defaults?.name} placeholder="Acme - ERP rollout" />
          </Field>
          <Field label="Customer" required error={fieldErrors.accountId?.[0]}
            help="The account you are selling to. Everything downstream - quotes, contracts, invoices - inherits it from here.">
            <RecordLookup entity="account" name="accountId" value={accountId} onChange={(id) => { setAccountId(id ?? ""); setPrimaryContactId(""); }} required disabled={Boolean(lockedAccountId)} emptyLabel="Select an account…" />
          </Field>
          <Field
            label="Primary contact"
            hint={accountId ? undefined : "Pick a customer first."}
            help="The person you are actually dealing with. They receive the quotation when you send it."
          >
            <RecordLookup entity="contact" name="primaryContactId" value={primaryContactId} onChange={(id) => setPrimaryContactId(id ?? "")} filters={{ accountId: accountId || null }} disabled={!accountId} emptyLabel="None" />
          </Field>
          <Field label="Owner" required error={fieldErrors.ownerUserId?.[0]}
            help="Whoever is running this deal. It appears in their pipeline and counts towards their numbers.">
            <RecordLookup entity="user" name="ownerUserId" defaultValue={defaults?.ownerUserId ?? currentUserId} required />
          </Field>

          {!editing && (
            <Field label="Stage" required hint="After this, the stage moves only from the deal page - the close rules live there."
            help="How far along the deal is. Moving it to Closed Won is what makes it count as revenue.">
              <Select name="stage" required defaultValue="DISCOVERY">
                <PicklistOptions list="opportunity_stage" fallback={STAGES} within={STAGES} />
              </Select>
            </Field>
          )}

          <Field label="Deal type" required
            help="Whether this is new business or expansion of an existing customer. Worth splitting in reporting.">
            <PicklistSelect list="opportunity_type" name="opportunityType" required emptyLabel={null} fallback={TYPES} defaultValue={defaults?.opportunityType ?? "NEW"} addLabel="Add a deal type" />
          </Field>
          <Field label="Expected close date" required error={fieldErrors.expectedCloseDate?.[0]}
            help="When you realistically expect a decision. Drives the forecast, so an honest date is worth more than an optimistic one.">
            <Input
              name="expectedCloseDate"
              type="date"
              required
              defaultValue={defaults?.expectedCloseDate.slice(0, 10) ?? ""}
            />
          </Field>
          <Field label="Probability %" hint="Left blank, the stage sets it."
            help="Your confidence this closes, as a percentage. Used to weight the pipeline - 50% on a 100,000 deal counts as 50,000.">
            <Input
              name="probabilityPercent"
              type="number"
              min="0"
              max="100"
              defaultValue={defaults ? Number(defaults.probabilityPercent).toFixed(0) : ""}
            />
          </Field>
          <Field label="Campaign"
            help="The marketing push behind this deal, if there was one. Links spend to revenue.">
            <RecordLookup entity="campaign" name="campaignId" defaultValue={defaults?.campaignId ?? ""} emptyLabel="None" />
          </Field>
          <Field label="Lead source"
            help="Where the deal originally came from. Carried over automatically if it started as a lead.">
            <PicklistSelect list="lead_source" name="leadSource" defaultValue={defaults?.leadSource ?? ""} addLabel="Add a lead source" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Value</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {priced
              ? "Set by the products and services on this deal. Change them on the deal's page with Add Product & Service."
              : editing
                ? "An estimate until products and services are added on the deal's page. From then on, the value is their total."
                : "An estimate for now. After saving, add the products and services on the deal's page - the value then becomes their total."}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label={priced ? "Amount" : "Estimated amount"}
            error={fieldErrors.amount?.[0]}
            help="What the deal is worth. Commission and the pipeline both read this figure."
          >
            {priced ? (
              <Input value={formatMoney(amount, currencyCode)} readOnly disabled />
            ) : (
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            )}
          </Field>
          <Field label="Currency" required help="Every amount on the deal is calculated in this currency.">
            <Select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Next step"
            help="The one thing that has to happen next. Read it back in a week and you will know if the deal has stalled.">
            <Input name="nextStep" defaultValue={defaults?.nextStep ?? ""} placeholder="Send revised pricing by Friday" />
          </Field>
          <Field label="Description"
            help="Background a colleague would need if they picked this up tomorrow.">
            <Textarea name="description" rows={4} defaultValue={defaults?.description ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create opportunity"}
        </Button>
      </div>
    </form>
  );
}
