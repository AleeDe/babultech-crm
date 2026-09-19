"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContract, updateContract } from "@/server/contracts";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { PicklistOptions } from "@/components/picklist";
import { formatMoney, humanize } from "@/lib/utils";

const STATUSES = ["DRAFT", "UNDER_REVIEW", "SENT_FOR_SIGNATURE", "ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"];
const FREQUENCIES = ["ONE_TIME", "MONTHLY", "QUARTERLY", "MILESTONE", "ANNUAL"];
const RENEWALS = ["MANUAL", "AUTO_RENEW"];

export interface ContractFormOptions {
  accounts: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  opportunities: { id: string; opportunityNumber: string; name: string; accountId: string }[];
  quotations: {
    id: string; quoteNumber: string; versionNumber: number; accountId: string;
    opportunityId: string; totalAmount: string; currencyCode: string;
  }[];
  currencies: { code: string; name: string }[];
}

export interface ContractDefaults {
  id: string;
  name: string;
  accountId: string;
  opportunityId: string | null;
  quotationId: string | null;
  ownerUserId: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate: string;
  contractValue: string;
  currencyCode: string;
  billingFrequency: string | null;
  renewalType: string | null;
  noticePeriodDays: number | null;
  signedDate: string | null;
  terminationReason: string | null;
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function ContractForm({
  options,
  defaults,
  prefill,
  currentUserId,
}: {
  options: ContractFormOptions;
  defaults?: ContractDefaults;
  /**
   * Starting values for a new contract, as opposed to `defaults`, which loads
   * an existing one for editing and carries an id.
   *
   * Set when arriving from an accepted quotation, which is the direction this
   * usually runs: the quote is what was agreed, and the contract turns it into
   * a term. Coming the other way — opening a blank form and hunting for the
   * quote — meant choosing the customer first, because the quote list is
   * filtered by them.
   */
  prefill?: { accountId?: string; quotationId?: string; opportunityId?: string };
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const seeded = prefill?.quotationId
    ? options.quotations.find((q) => q.id === prefill.quotationId)
    : undefined;

  const [accountId, setAccountId] = useState(
    defaults?.accountId ?? prefill?.accountId ?? "",
  );
  const [status, setStatus] = useState(defaults?.status ?? "DRAFT");
  // Seeded from the quote for the same reason picking it in the form does:
  // the value was already agreed, and retyping it is how the two drift apart.
  const [value, setValue] = useState(
    defaults?.contractValue ?? (seeded ? String(seeded.totalAmount) : ""),
  );
  const [currency, setCurrency] = useState(
    defaults?.currencyCode ?? seeded?.currencyCode ?? "PKR",
  );

  const editing = Boolean(defaults);
  const accountOpportunities = useMemo(
    () => options.opportunities.filter((o) => o.accountId === accountId),
    [options.opportunities, accountId],
  );
  const accountQuotes = useMemo(
    () => options.quotations.filter((q) => q.accountId === accountId),
    [options.quotations, accountId],
  );

  /** An accepted quote already says what was agreed — carry it over. */
  function seedFromQuote(quotationId: string) {
    const quote = options.quotations.find((q) => q.id === quotationId);
    if (!quote) return;
    setValue(String(Number(quote.totalAmount)));
    setCurrency(quote.currencyCode);
  }

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
      name: String(formData.get("name") ?? ""),
      accountId,
      opportunityId: get("opportunityId"),
      quotationId: get("quotationId"),
      ownerUserId: String(formData.get("ownerUserId") ?? ""),
      contractType: String(formData.get("contractType") ?? ""),
      status,
      startDate: get("startDate"),
      endDate: get("endDate"),
      contractValue: value || "0",
      currencyCode: currency,
      billingFrequency: get("billingFrequency"),
      renewalType: get("renewalType"),
      noticePeriodDays: get("noticePeriodDays"),
      signedDate: get("signedDate"),
      terminationReason: get("terminationReason"),
    } as never;

    startTransition(async () => {
      const result = defaults
        ? await updateContract(defaults.id, input)
        : await createContract(input);

      if (result.ok) {
        router.push(`/contracts/${result.data.id}`);
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
          <CardTitle>Agreement</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Contract name" required error={fieldErrors.name?.[0]}
            help="What this agreement is called. Use something the customer would recognise.">
            <Input name="name" required defaultValue={defaults?.name} placeholder="Acme - annual support" />
          </Field>
          <Field label="Customer" required
            help="The account the contract is with.">
            <Select
              name="accountId"
              required
              value={accountId}
              disabled={editing}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select a customer…</option>
              {options.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Contract type" required
            help="The kind of agreement - a one-off, a subscription, a support agreement.">
            <Input name="contractType" required defaultValue={defaults?.contractType} placeholder="Support / Licence / Services" />
          </Field>
          <Field label="Owner" required
            help="Who is responsible for this agreement and its renewal.">
            <Select name="ownerUserId" required defaultValue={defaults?.ownerUserId ?? currentUserId}>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="From accepted quote"
            // The list is filtered to the chosen customer, so before one is
            // picked it is necessarily empty — and an empty dropdown reading
            // "None" looks like "no quotes exist" rather than "choose a
            // customer first". The hint says which it is.
            hint={
              !accountId
                ? "Choose a customer first - this lists their accepted quotes."
                : accountQuotes.length === 0
                  ? "This customer has no accepted quotes yet. A quote must be accepted before a contract can be built from it."
                  : "Fills the value and currency for you."
            }
            help="Build the contract from a quote the customer already accepted, so the values carry across rather than being retyped.">
            <Select
              name="quotationId"
              defaultValue={defaults?.quotationId ?? prefill?.quotationId ?? ""}
              disabled={!accountId}
              onChange={(e) => seedFromQuote(e.target.value)}
            >
              <option value="">None</option>
              {accountQuotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.quoteNumber} v{q.versionNumber} - {formatMoney(q.totalAmount, q.currencyCode)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Opportunity"
            help="The deal that produced this contract.">
            <Select name="opportunityId" defaultValue={defaults?.opportunityId ?? prefill?.opportunityId ?? ""} disabled={!accountId}>
              <option value="">None</option>
              {accountOpportunities.map((o) => (
                <option key={o.id} value={o.id}>{o.opportunityNumber} - {o.name}</option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Term and value</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status" required
            help="Where the contract stands. Only an active contract should be billed against.">
            <Select name="status" required value={status} onChange={(e) => setStatus(e.target.value)}>
              <PicklistOptions list="contract_status" fallback={STATUSES} within={STATUSES} current={status} />
            </Select>
          </Field>
          <Field label="Start date" required
            help="When the agreement takes effect.">
            <Input name="startDate" type="date" required defaultValue={dateInput(defaults?.startDate ?? null)} />
          </Field>
          <Field label="End date" required error={fieldErrors.endDate?.[0]}
            help="When it expires. Drives the renewal reminder.">
            <Input name="endDate" type="date" required defaultValue={dateInput(defaults?.endDate ?? null)} />
          </Field>
          <Field
            label="Signed on"
            required={status === "ACTIVE"}
            error={fieldErrors.signedDate?.[0]}
            hint="Required before a contract can be Active."
            help="The date it was actually signed. Often later than the start date."
          >
            <Input name="signedDate" type="date" defaultValue={dateInput(defaults?.signedDate ?? null)} />
          </Field>
          <Field label="Contract value" required
            help="The total value over the whole term.">
            <Input
              name="contractValue"
              type="number"
              step="0.01"
              min="0"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Field label="Currency" required
            help="The currency the contract is denominated in.">
            <Select name="currencyCode" required value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Billing frequency"
            help="How often the customer is invoiced under it - monthly, quarterly, annually, or once.">
            <Select name="billingFrequency" defaultValue={defaults?.billingFrequency ?? ""}>
              <option value="">Not set</option>
              <PicklistOptions list="billing_frequency" fallback={FREQUENCIES} within={FREQUENCIES} current={defaults?.billingFrequency ?? ""} />
            </Select>
          </Field>
          <Field label="Renewal"
            help="Whether it renews automatically or has to be re-signed each term.">
            <Select name="renewalType" defaultValue={defaults?.renewalType ?? ""}>
              <option value="">Not set</option>
              <PicklistOptions list="renewal_type" fallback={RENEWALS} within={RENEWALS} current={defaults?.renewalType ?? ""} />
            </Select>
          </Field>
          <Field label="Notice period (days)" hint="Drives the renewal warning on the contract."
            help="How much notice either side must give to end it. Worth knowing well before the end date arrives.">
            <Input name="noticePeriodDays" type="number" min="0" defaultValue={defaults?.noticePeriodDays ?? 90} />
          </Field>

          {status === "TERMINATED" && (
            <div className="sm:col-span-2 lg:col-span-4">
              <Field label="Termination reason" required error={fieldErrors.terminationReason?.[0]}
            help="Why it ended, if it did. Filled in when a contract is cancelled, not when it is created.">
                <Textarea name="terminationReason" rows={2} required defaultValue={defaults?.terminationReason ?? ""} />
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
          {pending ? "Saving…" : editing ? "Save contract" : "Create contract"}
        </Button>
      </div>
    </form>
  );
}
