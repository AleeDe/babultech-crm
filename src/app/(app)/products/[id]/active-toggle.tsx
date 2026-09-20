"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { setProductActive } from "@/server/crm";

/**
 * Retire a product, or put it back on sale.
 *
 * Not a form field: whether something may still be sold is a decision about the
 * product's life, not part of its description, and it is the one thing you want
 * to change without opening the edit form.
 */
export function ProductActiveToggle({ productId, active }: { productId: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    start(async () => {
      const result = await setProductActive(productId, !active);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <>
      <Button variant="outline" onClick={onClick} disabled={pending}>
        {pending ? "Saving…" : active ? "Retire" : "Put back on sale"}
      </Button>
      {error && <p role="alert" className="w-full text-right text-sm text-destructive">{error}</p>}
    </>
  );
}
