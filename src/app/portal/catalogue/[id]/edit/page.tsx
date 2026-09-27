import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartnerItem } from "@/server/partner-catalogue";
import { PageHeader, Alert, Button } from "@/components/ui";
import { PartnerItemForm } from "../../item-form";

/** Changing one of the partner company's own items. BabulTech's are read-only. */
export default async function PortalEditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getPartnerItem(id);
  if (!item) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        backTo={`/portal/catalogue/${id}`}
        backLabel="Back to the item"
        title={`Edit ${item.name}`}
        description={item.productCode}
      />
      {item.mine ? (
        <PartnerItemForm
          defaults={{
            id: item.id,
            name: item.name,
            productCode: item.productCode,
            productType: item.productType,
            addInTask: item.addInTask,
            active: item.active,
            description: item.description,
            ownerAccountId: null,
          }}
          typeLocked={item.typeLocked}
        />
      ) : (
        <>
          <Alert tone="info">
            This is one of BabulTech&apos;s products and services, so it is read-only here. Put it on a
            deal and change its price there if you need to.
          </Alert>
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link href={`/portal/catalogue/${id}`}>Back to the item</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
