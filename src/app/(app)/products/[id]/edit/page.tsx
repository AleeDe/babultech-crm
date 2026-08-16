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
            <FormField label="Code" name="productCode" required>
              <Input name="productCode" required defaultValue={product.productCode} />
            </FormField>

            <FormField label="Category" name="category">
              <Input name="category" defaultValue={product.category ?? ""} />
            </FormField>
          </div>

          <FormField label="Name" name="name" required>
            <Input name="name" required defaultValue={product.name} />
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Type" name="productType" required>
              <Select name="productType" required defaultValue={product.productType}>
                <option value="PRODUCT">Product</option>
                <option value="SERVICE">Service</option>
                <option value="SUBSCRIPTION">Subscription</option>
              </Select>
            </FormField>

            <FormField label="Billing" name="billingType" required>
              <Select name="billingType" required defaultValue={product.billingType}>
                <option value="FIXED">Fixed</option>
                <option value="HOURLY">Hourly</option>
                <option value="RETAINER">Retainer</option>
                <option value="MILESTONE">Milestone</option>
                <option value="ANNUAL">Annual</option>
              </Select>
            </FormField>

            <FormField label="Standard price" name="standardPrice">
              <Input
                name="standardPrice"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product.standardPrice ?? ""}
              />
            </FormField>

            <FormField label="Standard cost" name="standardCost" hint="What it costs you. Used for margin.">
              <Input
                name="standardCost"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product.standardCost ?? ""}
              />
            </FormField>

            <FormField label="Unit" name="unitOfMeasure">
              <Input name="unitOfMeasure" defaultValue={product.unitOfMeasure ?? ""} />
            </FormField>

            <FormField label="Default tax rate" name="defaultTaxRateId">
              <Select name="defaultTaxRateId" defaultValue={product.defaultTaxRateId ?? ""}>
                <option value="">None</option>
                {taxRates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.ratePercent}%)
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Commission %" name="commissionPercent" hint="What a partner earns on it.">
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

          <FormField label="Description" name="description">
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
