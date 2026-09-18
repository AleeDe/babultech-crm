"use client";

import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { FormField } from "@/components/record-form";
import { ProductOptionPicker } from "@/components/product-option-picker";
import { BILLING_OPTIONS, priceBasis } from "@/lib/product-options";
import type { ProductPlan } from "@/lib/product-plans";
import { humanize } from "@/lib/utils";

type Draft = Omit<ProductPlan, "standardPrice" | "standardCost"> & { standardPrice: string; standardCost: string };
export function PricingPlans({ initial, units }: { initial: ProductPlan[]; units: string[] }) {
  const [plans, setPlans] = useState<Draft[]>(() => initial.map((p) => ({ ...p, standardPrice: p.standardPrice == null ? "" : String(p.standardPrice), standardCost: p.standardCost == null ? "" : String(p.standardCost) })));
  const patch = (id: string, value: Partial<Draft>) => setPlans((rows) => rows.map((row) => row.id === id ? { ...row, ...value } : row));
  return <FormField label="Pricing plans" name="pricingPlans" required help="One product can have multiple plans. Add Lifetime with Fixed billing, Basic with Monthly billing and Pro with Monthly billing. The first plan is the default catalogue price.">
    <input type="hidden" name="pricingPlans" value={JSON.stringify(plans)} />
    <p className="mb-3 text-sm text-muted-foreground">Offer one-time and monthly prices for the same product. Select the plan when quoting or invoicing. The first plan is the default.</p>
    <div className="space-y-4">
      {plans.map((plan, index) => {
        const basis = priceBasis(plan.billingType, plan.unitOfMeasure);
        return <fieldset key={plan.id} className="rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">Plan {index + 1}{index === 0 ? " · Default" : ""}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Plan name" name={`plan-name-${plan.id}`} help="A unique name for this offer, such as Lifetime, Basic or Pro."><Input aria-label={`Plan ${index + 1} name`} required maxLength={100} value={plan.name} onChange={(e) => patch(plan.id, { name: e.target.value })} placeholder="Basic" title="Name this offer, e.g. Lifetime, Basic or Pro." /></FormField>
            <FormField label="Billing" name={`plan-billing-${plan.id}`} help="Fixed: one-time. Monthly: every month. Annual: every year. Hourly: per hour. Milestone: per delivery milestone. Retainer: per agreed service period."><Select aria-label={`Plan ${index + 1} billing`} value={plan.billingType} onChange={(e) => patch(plan.id, { billingType: e.target.value as ProductPlan["billingType"] })} title="Choose Fixed for a one-time plan or Monthly for a monthly plan.">{BILLING_OPTIONS.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</Select></FormField>
            <div className="sm:col-span-2"><FormField label="Unit" name={`plan-unit-${plan.id}`} help="Licence prices the customer licence; User charges for every user. Monthly + User means per user per month."><ProductOptionPicker name={`plan-unit-${plan.id}`} kind="unit" options={units} defaultValue={plan.unitOfMeasure ?? ""} onChange={(value) => patch(plan.id, { unitOfMeasure: value || null })} /></FormField></div>
            <FormField label={`Price (${basis})`} name={`plan-price-${plan.id}`} help={`Selling price ${basis}, before tax and discounts. Enter 3000 for a Basic monthly price of 3,000. Changing billing does not convert the amount.`}><Input aria-label={`Plan ${index + 1} price`} title={`Selling price ${basis}. Leave blank if undecided; zero means free.`} type="number" min="0" step="0.01" value={plan.standardPrice} onChange={(e) => patch(plan.id, { standardPrice: e.target.value })} placeholder="0.00" /></FormField>
            <FormField label={`Cost (${basis})`} name={`plan-cost-${plan.id}`} help={`Your cost ${basis}. Use the same unit and period as price. Leave blank if unknown; development investment is tracked on linked projects.`}><Input aria-label={`Plan ${index + 1} cost`} title={`Your cost ${basis}. Leave blank if unknown.`} type="number" min="0" step="0.01" value={plan.standardCost} onChange={(e) => patch(plan.id, { standardCost: e.target.value })} placeholder="0.00" /></FormField>
          </div>
          {plans.length > 1 && <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => setPlans((rows) => rows.filter((p) => p.id !== plan.id))}>Remove plan</Button>}
        </fieldset>;
      })}
      <Button type="button" variant="outline" disabled={plans.length >= 50} onClick={() => setPlans((rows) => [...rows, { id: crypto.randomUUID(), name: "", billingType: "MONTHLY", unitOfMeasure: "Licence", standardPrice: "", standardCost: "" }])}>Add pricing plan</Button>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Monthly and annual plans describe the charge period. Invoices are created through the billing workflow; selecting a plan does not start automatic collections.</p>
  </FormField>;
}
