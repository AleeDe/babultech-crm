"use client";

import { type ComponentProps } from "react";
import { Input, Select, Textarea } from "@/components/ui";
import { FormField as BaseFormField } from "@/components/record-form";
import { ProductOptionPicker } from "@/components/product-option-picker";

/**
 * What a product is, and nothing about what it costs.
 *
 * Prices live in the product's price books, which are managed on the product's
 * own page: one product can be offered at several prices (Standard, Premium,
 * this year's rates), and a deal keeps the book it was sold on.
 */

const HELP: Record<string, string> = {
  name: "Enter the catalogue name customers will see on quotes and invoices, for example BabulPOS.",
  category: "Choose Software for BabulPOS. Search and select an existing category; similar names are suggested to avoid duplicates. Create a new category only if none fits.",
  productType: "Product: an item or software licence, such as BabulPOS. Service: work such as installation or training. Subscription: recurring access, such as a monthly hosted plan.",
  defaultTaxRateId: "Select the configured tax rate that applies to this sale. It becomes the default on quote and invoice lines. Choose None only when no default tax should be applied; confirm the rate with your finance team if unsure.",
  commissionPercent: "Optional product-specific partner commission percentage, from 0 to 100. Leave blank to use the applicable commission plan. This is a percentage, not a currency amount; enter 5 for 5%.",
  description: "Describe what is included, features, licence or user limits, support and exclusions. Example: BabulPOS software for one store, including sales and inventory management. Set the prices in Price books on the product's page.",
};

function FormField(props: ComponentProps<typeof BaseFormField>) {
  const help = props.help ?? HELP[props.name];
  return <div title={help}><BaseFormField {...props} help={help} /></div>;
}

export function ProductFields({ defaults = {}, taxRates, options }: {
  defaults?: Record<string, any>;
  taxRates: { id: string; name: string; ratePercent: string | number }[];
  options: { categories: string[]; units: string[] };
}) {
  return <>
    <FormField label="Name" name="name" required><Input name="name" required defaultValue={defaults.name ?? ""} placeholder="BabulPOS" /></FormField>
    {defaults.productCode && (
      <FormField label="Code" name="productCode" help="Generated when the product was created. It appears on quotes and invoices and cannot be changed.">
        <Input name="productCode" defaultValue={defaults.productCode} readOnly disabled className="font-mono text-xs" />
      </FormField>
    )}
    <div className="grid gap-5 sm:grid-cols-2">
      <FormField label="Category" name="category"><ProductOptionPicker name="category" kind="category" options={options.categories} defaultValue={defaults.category ?? ""} /></FormField>
      <FormField label="Type" name="productType" required><Select name="productType" required defaultValue={defaults.productType ?? "PRODUCT"}><option value="PRODUCT">Product</option><option value="SERVICE">Service</option><option value="SUBSCRIPTION">Subscription</option></Select></FormField>
    </div>
    <div className="grid gap-5 sm:grid-cols-2">
      <FormField label="Default tax rate" name="defaultTaxRateId"><Select name="defaultTaxRateId" defaultValue={defaults.defaultTaxRateId ?? ""}><option value="">None</option>{taxRates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.ratePercent}%)</option>)}</Select></FormField>
      <FormField label="Commission %" name="commissionPercent"><Input name="commissionPercent" type="number" min="0" max="100" step="0.01" defaultValue={defaults.commissionPercent ?? ""} /></FormField>
    </div>
    <FormField label="Description" name="description"><Textarea name="description" rows={3} defaultValue={defaults.description ?? ""} /></FormField>
    <p className="text-sm text-muted-foreground">
      Prices are set in Price books on the product&apos;s page, so one product can be offered at more
      than one price.
    </p>
  </>;
}
