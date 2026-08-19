import { notFound } from "next/navigation";
import { getProduct, updateProduct, getCreateFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Input, Select, Textarea } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="editing products" />;

  const { id } = await params;
  const [product, { taxRates }] = await Promise.all([getProduct(id), getCreateFormOptions()]);
  if (!product) notFound();

  // updateProduct takes the id first, so it is bound here rather than passed
  // through the form as a hidden field the client could rewrite.
  const save = updateProduct.bind(null, id);

  return (
    <>
      <PageHeader title={`Edit ${product.name}`} description={product.productCode} />

      <div className="max-w-2xl">
        <RecordForm action={save} redirectTo={`/products/${id}`} submitLabel="Save changes">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Code" name="productCode" required
            help="Your internal SKU or reference. Must be unique, and it is what people search by.">
              <Input name="productCode" required defaultValue={product.productCode} />
            </FormField>

            <FormField label="Category" name="category"
            help="How it groups in the catalogue and in revenue reporting.">
              <Input name="category" defaultValue={product.category ?? ""} />
            </FormField>
          </div>

          <FormField label="Name" name="name" required
            help="What the product or service is called on a quotation.">
            <Input name="name" required defaultValue={product.name} />
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Type" name="productType" required
            help="Whether this is a physical product, a service, a licence or a subscription.">
              <Select name="productType" required defaultValue={product.productType}>
                <option value="PRODUCT">Product</option>
                <option value="SERVICE">Service</option>
                <option value="SUBSCRIPTION">Subscription</option>
              </Select>
            </FormField>

            <FormField label="Billing" name="billingType" required
            help="Whether it is charged once or recurs.">
              <Select name="billingType" required defaultValue={product.billingType}>
                <option value="FIXED">Fixed</option>
                <option value="HOURLY">Hourly</option>
                <option value="RETAINER">Retainer</option>
                <option value="MILESTONE">Milestone</option>
                <option value="ANNUAL">Annual</option>
              </Select>
            </FormField>

            <FormField label="Standard price" name="standardPrice"
            help="The normal selling price before any discount. Quote lines start from this.">
              <Input
                name="standardPrice"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product.standardPrice ?? ""}
              />
            </FormField>

            <FormField label="Standard cost" name="standardCost" hint="What it costs you. Used for margin."
            help="What it costs you. Used to work out margin, and never shown to a customer.">
              <Input
                name="standardCost"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product.standardCost ?? ""}
              />
            </FormField>

            <FormField label="Unit" name="unitOfMeasure"
            help="What you sell it by — each, per hour, per user, per month.">
              <Input name="unitOfMeasure" defaultValue={product.unitOfMeasure ?? ""} />
            </FormField>

            <FormField label="Default tax rate" name="defaultTaxRateId"
            help="The tax applied by default on quotes and invoices. Can still be changed per line.">
              <Select name="defaultTaxRateId" defaultValue={product.defaultTaxRateId ?? ""}>
                <option value="">None</option>
                {taxRates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.ratePercent}%)
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Commission %" name="commissionPercent" hint="What a partner earns on it."
            help="The commission rate earned on this product, when it differs from the plan's default.">
              <Input
                name="commissionPercent"
                type="number"
                step="0.01"
                min="0"
                max="100"
                defaultValue={product.commissionPercent ?? ""}
              />
            </FormField>
          </div>

          <FormField label="Description" name="description"
            help="What it actually is. This can appear on the quotation, so write it for the customer.">
            <Textarea name="description" rows={3} defaultValue={product.description ?? ""} />
          </FormField>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="commissionable" value="true" defaultChecked={product.commissionable} />
              Commissionable
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" value="true" defaultChecked={product.active} />
              Active — available to quote
            </label>
          </div>
        </RecordForm>
      </div>
    </>
  );
}
