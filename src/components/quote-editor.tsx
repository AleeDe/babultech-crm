"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { RecordLookup } from "@/components/record-lookup";
import {
  PricedLinesEditor, emptyRow, num, rowFromLine, type PricedRow, type SavedLine,
} from "@/components/priced-lines";
import type { OpportunityPricing } from "@/lib/opportunity-pricing";
import type { ActionResult } from "@/server/partners";

export interface QuoteDefaults {
  id: string;
  quoteNumber: string;
  opportunityId: string;
  contactId: string | null;
  quoteDate: string;
  expiryDate: string;
  currencyCode: string;
  priceBookId: string | null;
  paymentTerms: string | null;
  notes: string | null;
  termsAndConditions: string | null;
  lines: SavedLine[];
}

/** The deal a quote is for, as the form needs it. */
export interface QuoteEditorDeal {
  id: string;
  opportunityNumber: string;
  name: string;
  accountId: string;
  primaryContactId: string | null;
  currencyCode: string;
}

/** What the form hands whoever saves it. Dates are as typed, YYYY-MM-DD. */
export interface QuoteFormValues {
  opportunityId: string;
  contactId: string | null;
  quoteDate: string | null;
  expiryDate: string | null;
  currencyCode: string;
  priceBookId: string;
  paymentTerms: string | null;
  notes: string | null;
  termsAndConditions: string | null;
  lines: {
    productId: string;
    priceBookEntryId: string | null;
    description: string | null;
    quantity: number;
    unitPrice: number;
    licenseCost: number;
    maintenanceCost: number;
    cloudCost: number;
    aiCost: number;
    discountPercent: number;
    taxRateId: string | null;
  }[];
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A quote for one deal, priced as the deal is - the form our team and our
 * partners share, so a quote reads the same whoever prepared it.
 *
 * A new quote starts as a copy of everything the deal sells - each product and
 * service with its quantity, price, the four costs, discount and tax, and the
 * deal's price book, contact and currency - and every value can be changed
 * before it goes out. Accepting it later puts these lines back on the deal.
 *
 * Whoever renders it decides how it is saved and where to go afterwards: our
 * quotations, or the partner portal's.
 */
export function QuoteEditor({
  deal,
  dealHref,
  pricing,
  currencies,
  defaults,
  contacts,
  termsHelp = "The conditions printed on the quotation. Set a default in Settings so this does not get retyped.",
  onSave,
  onSaved,
}: {
  deal: QuoteEditorDeal;
  dealHref: string;
  pricing: OpportunityPricing;
  currencies: { code: string; name: string }[];
  defaults?: QuoteDefaults;
  /**
   * The people the quote may be addressed to, offered as a list. Without it,
   * any contact at the customer can be looked up.
   */
  contacts?: { id: string; name: string }[];
  termsHelp?: string;
  onSave: (values: QuoteFormValues) => Promise<ActionResult<{ id: string }>>;
  onSaved: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const dealRows = (): PricedRow[] => pricing.lines.map((l) => rowFromLine(l, false));
  const [rows, setRows] = useState<PricedRow[]>(() => {
    if (defaults) return defaults.lines.map((l) => rowFromLine(l, false));
    const fromDeal = dealRows();
    return fromDeal.length ? fromDeal : [emptyRow()];
  });
  const [bookId, setBookId] = useState(defaults?.priceBookId ?? pricing.priceBookId ?? "");
  const [contactId, setContactId] = useState(defaults?.contactId ?? deal.primaryContactId ?? "");
  const [currency, setCurrency] = useState(defaults?.currencyCode ?? deal.currencyCode ?? "PKR");

  const editing = Boolean(defaults);

  // One book per quote, as per deal: fixed once a line is priced from it.
  const bookLocked = rows.some((r) => r.priceBookEntryId);

  function copyFromDeal() {
    if (
      rows.some((r) => r.productId) &&
      !window.confirm("Replace the lines on this quote with the deal's products and services as they are now?")
    ) {
      return;
    }
    setRows(dealRows());
    setBookId(pricing.priceBookId ?? "");
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

    const usable = rows.filter((r) => r.productId);
    if (!bookId) {
      setError("Choose the price book this quote is priced from.");
      return;
    }
    if (usable.length === 0) {
      setError("A quote needs at least one product or service.");
      return;
    }

    const values: QuoteFormValues = {
      opportunityId: deal.id,
      contactId: contactId || null,
      quoteDate: get("quoteDate"),
      expiryDate: get("expiryDate"),
      currencyCode: currency,
      priceBookId: bookId,
      paymentTerms: get("paymentTerms"),
      notes: get("notes"),
      termsAndConditions: get("termsAndConditions"),
      lines: usable.map((r) => ({
        productId: r.productId,
        priceBookEntryId: r.priceBookEntryId,
        description: r.description.trim() || null,
        quantity: num(r.quantity),
        unitPrice: num(r.unitPrice),
        licenseCost: num(r.licenseCost),
        maintenanceCost: num(r.maintenanceCost),
        cloudCost: num(r.cloudCost),
        aiCost: num(r.aiCost),
        discountPercent: num(r.discountPercent),
        taxRateId: r.taxRateId || null,
      })),
    };

    startTransition(async () => {
      const result = await onSave(values);
      if (result.ok) {
        onSaved(result.data.id);
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
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Field label="Opportunity" help="The deal this quote is for. Accepting the quote puts its lines on this deal.">
              <p className="py-2 text-sm">
                <Link href={dealHref} className="font-medium text-primary hover:underline">
                  {deal.opportunityNumber} - {deal.name}
                </Link>
              </p>
            </Field>
          </div>
          <Field label="Contact" help="Who receives the quotation when you send it. Starts as the deal's main contact.">
            {contacts ? (
              <Select
                name="contactId"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                aria-label="Contact"
              >
                <option value="">None</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            ) : (
              <RecordLookup
                entity="contact"
                name="contactId"
                value={contactId}
                onChange={(id) => setContactId(id ?? "")}
                filters={{ accountId: deal.accountId }}
                emptyLabel="None"
              />
            )}
          </Field>
          <Field label="Currency" required help="The currency you are quoting in. Starts as the deal's.">
            <Select name="currencyCode" required value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Quote date" required help="The date on the quotation.">
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
            <Field label="Payment terms" help="The terms the customer is being offered, shown on the document.">
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
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Products and services</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {editing
                ? "Every value can be changed while the quote is a draft."
                : pricing.lines.length
                  ? "Copied from the deal - every value can be changed for this quote."
                  : "The deal has nothing on it yet, so start from the price book."}
            </p>
          </div>
          {pricing.lines.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={copyFromDeal} disabled={pending}>
              <Copy className="h-4 w-4" /> {editing ? "Copy the deal's lines again" : "Start again from the deal"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <PricedLinesEditor
            rows={rows}
            onRowsChange={setRows}
            bookId={bookId}
            onBookChange={setBookId}
            bookLocked={bookLocked}
            bookLockedNote="Fixed while lines on this quote are priced from it. Remove them to choose a different book."
            bookHelp="One price book per quote. Starts as the deal's; accepting the quote makes it the deal's book."
            catalogue={pricing}
            currency={currency}
            disabled={pending}
            withDescription
            totalLabel="Quote total"
            hoursNote="will become project tasks if the deal is won on this quote."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Terms and notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Terms and conditions" help={termsHelp}>
            <Textarea name="termsAndConditions" rows={4} defaultValue={defaults?.termsAndConditions ?? ""} />
          </Field>
          <Field label="Internal notes" hint="Not printed on the customer's copy."
            help="Notes for your own side only. These are never shown to the customer.">
            <Textarea name="notes" rows={3} defaultValue={defaults?.notes ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save quote" : "Create quote"}
        </Button>
      </div>
    </form>
  );
}
