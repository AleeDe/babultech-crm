"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { formatMoney } from "@/lib/utils";
import { commercialPlanSchema, planDescription, type ProductPlan, type CommercialPlan } from "@/lib/product-plans";

/**
 * The line grid shared by the quote builder and the invoice builder.
 *
 * It owns no state — the parent form holds the rows so it can submit them —
 * but it does own the arithmetic, so a quote and an invoice can never disagree
 * about what "3 units at 100 less 10% plus 18% tax" comes to. The same maths
 * is repeated server-side in computeTotals; this copy exists only so the user
 * sees the number update as they type.
 */

export interface LineRow {
  key: string;
  productId: string;
  productPlan?: CommercialPlan | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRateId: string;
}

export interface ProductOption {
  id: string;
  name: string;
  productCode: string;
  standardPrice: string | null;
  defaultTaxRateId: string | null;
  pricingPlans?: ProductPlan[];
}

export interface TaxRateOption {
  id: string;
  name: string;
  ratePercent: string;
}

let seq = 0;
export function newLine(): LineRow {
  seq += 1;
  return {
    key: `l${seq}`,
    productId: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    discountPercent: "",
    taxRateId: "",
  };
}

export function lineMaths(line: LineRow, taxRates: TaxRateOption[]) {
  const gross = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
  const discount = (gross * (Number(line.discountPercent) || 0)) / 100;
  const net = gross - discount;
  const rate = Number(taxRates.find((t) => t.id === line.taxRateId)?.ratePercent ?? 0);
  const tax = (net * rate) / 100;
  return { gross, discount, net, tax, total: net + tax };
}

export function documentTotals(lines: LineRow[], taxRates: TaxRateOption[]) {
  return lines.reduce(
    (acc, l) => {
      const m = lineMaths(l, taxRates);
      return {
        subtotal: acc.subtotal + m.gross,
        discount: acc.discount + m.discount,
        tax: acc.tax + m.tax,
        total: acc.total + m.total,
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );
}

export function LineEditor({
  lines,
  onChange,
  products,
  taxRates,
  currency,
  disabled,
}: {
  lines: LineRow[];
  onChange: (lines: LineRow[]) => void;
  products: ProductOption[];
  taxRates: TaxRateOption[];
  currency: string;
  disabled?: boolean;
}) {
  const totals = useMemo(() => documentTotals(lines, taxRates), [lines, taxRates]);

  function update(key: string, patch: Partial<LineRow>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // Picking a product fills the description, price and tax — all still editable,
  // because the catalogue price is a starting point, not a rule.
  function pickProduct(key: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    const line = lines.find((l) => l.key === key);
    update(key, {
      productId,
      productPlan: product?.pricingPlans?.length === 1 ? commercialPlanSchema.parse(product.pricingPlans[0]) : null,
      description: product?.pricingPlans?.length === 1 ? planDescription(product.name, product.pricingPlans[0]) : product?.name ?? line?.description ?? "",
      unitPrice: (product?.pricingPlans?.length ?? 0) > 1 ? "" : String(product?.standardPrice ?? line?.unitPrice ?? ""),
      taxRateId: product?.defaultTaxRateId ?? line?.taxRateId ?? "",
    });
  }

  return (
    <div className="space-y-3">
      {lines.length === 0 && (
        <p className="text-sm text-muted-foreground">No lines yet - add the first one.</p>
      )}

      {lines.map((line) => {
        const m = lineMaths(line, taxRates);
        return (
          <div key={line.key} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-12">
            <div className="sm:col-span-3">
              <Field label="Product">
                <Select
                  value={line.productId}
                  disabled={disabled}
                  onChange={(e) => pickProduct(line.key, e.target.value)}
                >
                  <option value="">Free text</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.productCode})</option>
                  ))}
                </Select>
              </Field>
              {(products.find((p) => p.id === line.productId)?.pricingPlans?.length || line.productPlan) && (
                <Field label="Pricing plan" help="Choose the one-time or recurring offer. The selected plan fills the price and description; prices remain editable for negotiated deals.">
                  <Select aria-label="Pricing plan" required disabled={disabled} value={line.productPlan?.id ?? ""} onChange={(e) => {
                    const product = products.find((p) => p.id === line.productId);
                    const plan = product?.pricingPlans?.find((p) => p.id === e.target.value);
                    if (product && plan) update(line.key, { productPlan: commercialPlanSchema.parse(plan), description: planDescription(product.name, plan), unitPrice: plan.standardPrice == null ? "" : String(plan.standardPrice) });
                  }}>
                    <option value="" disabled>Choose a plan</option>
                    {line.productPlan && !products.find((p) => p.id === line.productId)?.pricingPlans?.some((p) => p.id === line.productPlan?.id) && <option value={line.productPlan.id}>{line.productPlan.name} (saved plan)</option>}
                    {products.find((p) => p.id === line.productId)?.pricingPlans?.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.billingType.toLowerCase()} · {p.standardPrice == null ? "Price not set" : formatMoney(p.standardPrice, currency)}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            <div className="sm:col-span-3">
              <Field label="Description">
                <Input
                  value={line.description}
                  disabled={disabled}
                  required
                  onChange={(e) => update(line.key, { description: e.target.value })}
                  placeholder="What the customer is being charged for"
                />
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label="Qty">
                <Input
                  type="number" step="0.01" min="0.01" value={line.quantity} disabled={disabled}
                  onChange={(e) => update(line.key, { quantity: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Unit price">
                <Input
                  type="number" step="0.01" min="0" required value={line.unitPrice} disabled={disabled}
                  onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label="Disc %">
                <Input
                  type="number" step="0.01" min="0" max="100" value={line.discountPercent} disabled={disabled}
                  onChange={(e) => update(line.key, { discountPercent: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label="Tax">
                <Select
                  value={line.taxRateId}
                  disabled={disabled}
                  onChange={(e) => update(line.key, { taxRateId: e.target.value })}
                >
                  <option value="">None</option>
                  {taxRates.map((t) => (
                    <option key={t.id} value={t.id}>{Number(t.ratePercent).toFixed(0)}%</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex items-center justify-between gap-2 sm:col-span-1">
              <span className="text-sm tabular">{formatMoney(m.total, currency)}</span>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              )}
            </div>
          </div>
        );
      })}

      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, newLine()])}>
          <Plus className="h-4 w-4" /> Add line
        </Button>
      )}

      <div className="ml-auto max-w-xs space-y-1 border-t pt-3 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular">{formatMoney(totals.subtotal, currency)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular">−{formatMoney(totals.discount, currency)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular">{formatMoney(totals.tax, currency)}</span></div>
        <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span className="tabular">{formatMoney(totals.total, currency)}</span></div>
      </div>
    </div>
  );
}
