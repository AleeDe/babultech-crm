"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createOpportunity, updateOpportunity } from "@/server/opportunities";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { formatMoney, humanize } from "@/lib/utils";

const STAGES = [
  "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
  "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION", "ON_HOLD",
];
const TYPES = ["NEW", "RENEWAL", "UPSELL", "CROSS_SELL"];

/** Exported so the pages can cast `serialize()`'s output — serialize flattens
 *  Prisma Decimals to strings at runtime but keeps the original static type. */
export interface OpportunityFormOptions {
  users: { id: string; fullName: string }[];
  accounts: { id: string; name: string }[];
  contacts: { id: string; firstName: string; lastName: string; accountId: string | null }[];
  campaigns: { id: string; name: string }[];
  currencies: { code: string; name: string }[];
  products: {
    id: string;
    name: string;
    productCode: string;
    standardPrice: string | null;
    defaultTaxRateId: string | null;
  }[];
  taxRates: { id: string; name: string; ratePercent: string }[];
}

export interface LineDefaults {
  productId: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string | null;
  taxRateId: string | null;
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
  lines: LineDefaults[];
}

interface LineRow {
  key: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRateId: string;
}

let rowSeq = 0;
function newRow(): LineRow {
  rowSeq += 1;
  return { key: `r${rowSeq}`, productId: "", quantity: "1", unitPrice: "", discountPercent: "", taxRateId: "" };
}

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
  const [lines, setLines] = useState<LineRow[]>(
    defaults?.lines.length
      ? defaults.lines.map((l) => {
          rowSeq += 1;
          return {
            key: `r${rowSeq}`,
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent ?? "",
            taxRateId: l.taxRateId ?? "",
          };
        })
      : [],
  );

  const editing = Boolean(defaults);

  const contactsForAccount = useMemo(
    () => options.contacts.filter((c) => c.accountId === accountId),
    [options.contacts, accountId],
  );

  const linesTotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const gross = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
        return sum + gross - (gross * (Number(l.discountPercent) || 0)) / 100;
      }, 0),
    [lines],
  );

  function updateRow(key: string, patch: Partial<LineRow>) {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onPickProduct(key: string, productId: string) {
    const product = options.products.find((p) => p.id === productId);
    updateRow(key, {
      productId,
      unitPrice: product?.standardPrice ?? "",
      taxRateId: product?.defaultTaxRateId ?? "",
    });
  }

  function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const usable = lines.filter((l) => l.productId && Number(l.quantity) > 0);

    const base = {
      name: String(formData.get("name") ?? ""),
      accountId,
      primaryContactId: get("primaryContactId"),
      ownerUserId: String(formData.get("ownerUserId") ?? ""),
      campaignId: get("campaignId"),
      amount,
      currencyCode,
      probabilityPercent: get("probabilityPercent"),
      expectedCloseDate: get("expectedCloseDate"),
      opportunityType: get("opportunityType"),
      leadSource: get("leadSource"),
      nextStep: get("nextStep"),
      description: get("description"),
      lines: usable.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice || "0",
        discountPercent: l.discountPercent || null,
        taxRateId: l.taxRateId || null,
      })),
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
    <form action={onSubmit} className="space-y-6">
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
            <Select
              name="accountId"
              required
              value={accountId}
              disabled={Boolean(lockedAccountId)}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select an account…</option>
              {options.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Primary contact"
            hint={accountId ? undefined : "Pick a customer first."}
            help="The person you are actually dealing with. They receive the quotation when you send it."
          >
            <Select
              name="primaryContactId"
              defaultValue={defaults?.primaryContactId ?? ""}
              disabled={!accountId}
            >
              <option value="">None</option>
              {contactsForAccount.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" required error={fieldErrors.ownerUserId?.[0]}
            help="Whoever is running this deal. It appears in their pipeline and counts towards their numbers.">
            <Select name="ownerUserId" required defaultValue={defaults?.ownerUserId ?? currentUserId}>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </Select>
          </Field>

          {!editing && (
            <Field label="Stage" required hint="After this, the stage moves only from the deal page - the close rules live there."
            help="How far along the deal is. Moving it to Closed Won is what makes it count as revenue.">
              <Select name="stage" required defaultValue="DISCOVERY">
                {STAGES.map((s) => (
                  <option key={s} value={s}>{humanize(s)}</option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Deal type" required
            help="Whether this is new business or expansion of an existing customer. Worth splitting in reporting.">
            <Select name="opportunityType" required defaultValue={defaults?.opportunityType ?? "NEW"}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </Select>
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
            <Select name="campaignId" defaultValue={defaults?.campaignId ?? ""}>
              <option value="">None</option>
              {options.campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Lead source"
            help="Where the deal originally came from. Carried over automatically if it started as a lead.">
            <Input name="leadSource" defaultValue={defaults?.leadSource ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Value</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Amount" required error={fieldErrors.amount?.[0]}
            help="What the deal is worth. If you add product lines below, this is calculated from them rather than typed.">
            <Input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Currency" required
            help="The currency the customer will be billed in. Leave as PKR unless they are paying from abroad.">
            <Select
              name="currencyCode"
              required
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
            >
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              disabled={lines.length === 0}
              onClick={() => setAmount(linesTotal.toFixed(2))}
            >
              Use line total ({formatMoney(linesTotal, currencyCode)})
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Line items</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional. Products here feed margin and per-product commission rules.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((r) => [...r, newRow()])}>
            <Plus className="h-4 w-4" /> Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products on this deal.</p>
          ) : (
            lines.map((line) => {
              const gross = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
              const total = gross - (gross * (Number(line.discountPercent) || 0)) / 100;

              return (
                <div key={line.key} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-12">
                  <div className="sm:col-span-4">
                    <Field label="Product"
            help="The item being sold on this line, priced from the catalogue.">
                      <Select
                        value={line.productId}
                        onChange={(e) => onPickProduct(line.key, e.target.value)}
                      >
                        <option value="">Select…</option>
                        {options.products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.productCode})</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="sm:col-span-1">
                    <Field label="Qty"
            help="How many units of it.">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.quantity}
                        onChange={(e) => updateRow(line.key, { quantity: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Unit price">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitPrice}
                        onChange={(e) => updateRow(line.key, { unitPrice: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-1">
                    <Field label="Disc %"
            help="Discount on this line as a percentage. The deal total updates as you type.">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={line.discountPercent}
                        onChange={(e) => updateRow(line.key, { discountPercent: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Tax"
            help="The tax rate applied to this line.">
                      <Select
                        value={line.taxRateId}
                        onChange={(e) => updateRow(line.key, { taxRateId: e.target.value })}
                      >
                        <option value="">None</option>
                        {options.taxRates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({Number(t.ratePercent).toFixed(1)}%)
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:col-span-2">
                    <span className="text-sm tabular">{formatMoney(total, currencyCode)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setLines((rows) => rows.filter((r) => r.key !== line.key))}
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
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
