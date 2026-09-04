"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createQuotation, updateQuotation } from "@/server/quotations";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import {
  LineEditor, newLine, documentTotals,
  type LineRow, type ProductOption, type TaxRateOption,
} from "@/components/line-editor";
import { formatMoney } from "@/lib/utils";

export interface QuoteFormOptions {
  opportunities: {
    id: string;
    opportunityNumber: string;
    name: string;
    accountId: string;
    currencyCode: string;
    // Nullable because PostgREST returns an embedded to-one relation as an
    // array that may be empty, and the flattening in getQuotationFormOptions
    // turns that into null. The render already reads it with `?.`, so this
    // makes the type say what the code was doing.
    account: { name: string } | null;
    lines: {
      productId: string;
      quantity: string;
      unitPrice: string;
      discountPercent: string | null;
      taxRateId: string | null;
      product: { name: string } | null;
    }[];
  }[];
  products: ProductOption[];
  taxRates: TaxRateOption[];
  currencies: { code: string; name: string }[];
  contacts: { id: string; firstName: string; lastName: string; accountId: string | null }[];
}

export interface QuoteDefaults {
  id: string;
  quoteNumber: string;
  opportunityId: string;
  contactId: string | null;
  quoteDate: string;
  expiryDate: string;
  currencyCode: string;
  paymentTerms: string | null;
  notes: string | null;
  termsAndConditions: string | null;
  lines: {
    productId: string | null;
    description: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string | null;
    taxRateId: string | null;
  }[];
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let importSeq = 0;

export function QuoteForm({
  options,
  defaults,
  lockedOpportunityId,
}: {
  options: QuoteFormOptions;
  defaults?: QuoteDefaults;
  lockedOpportunityId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [opportunityId, setOpportunityId] = useState(
    defaults?.opportunityId ?? lockedOpportunityId ?? "",
  );
  const [currency, setCurrency] = useState(defaults?.currencyCode ?? "PKR");
  const [lines, setLines] = useState<LineRow[]>(
    defaults?.lines.length
      ? defaults.lines.map((l) => {
          importSeq += 1;
          return {
            key: `d${importSeq}`,
            productId: l.productId ?? "",
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent ?? "",
            taxRateId: l.taxRateId ?? "",
          };
        })
      : [newLine()],
  );

  const editing = Boolean(defaults);
  const opportunity = options.opportunities.find((o) => o.id === opportunityId);
  const totals = useMemo(() => documentTotals(lines, options.taxRates), [lines, options.taxRates]);

  const contactsForAccount = useMemo(
    () => options.contacts.filter((c) => c.accountId === opportunity?.accountId),
    [options.contacts, opportunity],
  );

  /** Pulls the deal's product lines in, so a quote does not get retyped. */
  function importFromOpportunity() {
    if (!opportunity?.lines.length) return;
    setLines(
      opportunity.lines.map((l) => {
        importSeq += 1;
        return {
          key: `i${importSeq}`,
          productId: l.productId,
          // A line with no product still needs a description — the schema
          // requires one — so a deleted or missing product falls back to a
          // placeholder the person can type over rather than an empty cell
          // that silently fails validation on save.
          description: l.product?.name ?? "Item",
          quantity: String(Number(l.quantity)),
          unitPrice: String(Number(l.unitPrice)),
          discountPercent: l.discountPercent ? String(Number(l.discountPercent)) : "",
          taxRateId: l.taxRateId ?? "",
        };
      }),
    );
  }

  function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const usable = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0);
    if (usable.length === 0) {
      setError("A quote needs at least one line with a description and a quantity.");
      return;
    }

    const input = {
      opportunityId,
      contactId: get("contactId"),
      quoteDate: get("quoteDate"),
      expiryDate: get("expiryDate"),
      currencyCode: currency,
      paymentTerms: get("paymentTerms"),
      notes: get("notes"),
      termsAndConditions: get("termsAndConditions"),
      lines: usable.map((l) => ({
        productId: l.productId || null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice || "0",
        discountPercent: l.discountPercent || null,
        taxRateId: l.taxRateId || null,
      })),
    } as never;

    startTransition(async () => {
      const result = defaults
        ? await updateQuotation(defaults.id, input)
        : await createQuotation(input);

      if (result.ok) {
        router.push(`/quotations/${result.data.id}`);
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
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Field label="Opportunity" required error={fieldErrors.opportunityId?.[0]}
            help="The deal this quote is for. It carries over the customer and contact.">
              <Select
                name="opportunityId"
                required
                value={opportunityId}
                disabled={editing || Boolean(lockedOpportunityId)}
                onChange={(e) => {
                  setOpportunityId(e.target.value);
                  const opp = options.opportunities.find((o) => o.id === e.target.value);
                  if (opp) setCurrency(opp.currencyCode);
                }}
              >
                <option value="">Select a deal…</option>
                {options.opportunities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.opportunityNumber} - {o.name} ({o.account?.name})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Contact" hint={opportunityId ? undefined : "Pick a deal first."}
            help="Who receives the quotation when you send it.">
            <Select name="contactId" defaultValue={defaults?.contactId ?? ""} disabled={!opportunityId}>
              <option value="">None</option>
              {contactsForAccount.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Currency" required
            help="The currency you are quoting in.">
            <Select name="currencyCode" required value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Quote date" required
            help="The date on the quotation.">
            <Input
              name="quoteDate"
              type="date"
              required
              defaultValue={dateInput(defaults?.quoteDate ?? null) || inDays(0)}
            />
          </Field>
          <Field label="Valid until" required error={fieldErrors.expiryDate?.[0]}
            help="How long the prices hold. After this the quote reads as expired, which is what stops old pricing being accepted months later.">
            <Input
              name="expiryDate"
              type="date"
              required
              defaultValue={dateInput(defaults?.expiryDate ?? null) || inDays(30)}
            />
          </Field>
          <div className="lg:col-span-2">
            <Field label="Payment terms"
            help="The terms the customer is being offered, shown on the document.">
              <Input
                name="paymentTerms"
                defaultValue={defaults?.paymentTerms ?? ""}
                placeholder="50% on order, 50% on delivery"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Lines</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Discount comes off before tax. The server recalculates all of this on save.
            </p>
          </div>
          {opportunity && opportunity.lines.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={importFromOpportunity}>
              Pull {opportunity.lines.length} line(s) from the deal
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <LineEditor
            lines={lines}
            onChange={setLines}
            products={options.products}
            taxRates={options.taxRates}
            currency={currency}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Terms and notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Terms and conditions"
            help="The conditions printed on the quotation. Set a default in Settings so this does not get retyped.">
            <Textarea name="termsAndConditions" rows={4} defaultValue={defaults?.termsAndConditions ?? ""} />
          </Field>
          <Field label="Internal notes" hint="Not printed on the customer's copy."
            help="Notes for your own side only. These are never shown to the customer.">
            <Textarea name="notes" rows={3} defaultValue={defaults?.notes ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Quote total <span className="font-semibold text-foreground">{formatMoney(totals.total, currency)}</span>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save quote" : "Create quote"}
          </Button>
        </div>
      </div>
    </form>
  );
}
