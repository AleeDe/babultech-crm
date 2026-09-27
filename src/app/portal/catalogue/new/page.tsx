import Link from "next/link";
import { listPartnerCatalogue } from "@/server/partner-catalogue";
import { PageHeader, Alert, Button } from "@/components/ui";
import { PartnerItemForm } from "../item-form";

/** A new product or service of the partner company's own. */
export default async function PortalNewItemPage() {
  const { canAddItems } = await listPartnerCatalogue({ whose: "mine" });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        backTo="/portal/catalogue"
        backLabel="Back to products & services"
        title="New product or service"
        description="One of your company's own. You can put it on your deals, priced on each deal; BabulTech's price books are not changed."
      />
      {canAddItems ? (
        <PartnerItemForm />
      ) : (
        <>
          <Alert tone="info">
            Items of your own belong to a partner company. Please speak to your partner manager.
          </Alert>
          <div className="mt-4">
            <Button asChild variant="outline">
              <Link href="/portal/catalogue">Back to products & services</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
