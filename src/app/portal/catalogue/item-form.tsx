"use client";

import { useRouter } from "next/navigation";
import { ProductServiceForm } from "@/components/product-service-form";
import { savePartnerItem } from "@/server/partner-catalogue";

/**
 * One of the partner company's own items: our product form
 * (components/product-service-form), saved as theirs. The owner is always
 * their company, so there is none to choose.
 */
export function PartnerItemForm({
  defaults,
  typeLocked,
}: {
  defaults?: {
    id: string;
    name: string;
    productCode: string;
    productType: "PRODUCT" | "SERVICE";
    addInTask: boolean;
    active: boolean;
    description: string | null;
    ownerAccountId: string | null;
  };
  typeLocked?: boolean;
}) {
  const router = useRouter();
  return (
    <ProductServiceForm
      defaults={defaults}
      typeLocked={typeLocked}
      save={savePartnerItem}
      onSaved={(id) => router.push(`/portal/catalogue/${id}`)}
      showOwner={false}
      activeHint="can be put on deals"
    />
  );
}
