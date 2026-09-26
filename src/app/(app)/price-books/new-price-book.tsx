"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { savePriceBook } from "@/server/price-books";

/** A small inline form: a new book needs only a name and dates. */
export function NewPriceBook() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const result = await savePriceBook({
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? ""),
        currencyCode: "PKR",
        validFrom: String(fd.get("validFrom") ?? "") || null,
        validTo: String(fd.get("validTo") ?? "") || null,
        active: true,
      });
      if (result.ok) {
        router.push(`/price-books/${result.data.id}`);
        router.refresh();
      } else setError(result.error);
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New price book
      </Button>
    );
  }

  const year = new Date().getFullYear();

  return (
    <form action={submit} className="flex w-full flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
      {error && <div className="w-full"><Alert tone="danger">{error}</Alert></div>}
      <Field label="Name" required>
        <Input name="name" required maxLength={100} defaultValue={`${year} Standard Rates`} />
      </Field>
      <Field label="Description">
        <Input name="description" maxLength={2000} />
      </Field>
      <Field label="Valid from">
        <Input name="validFrom" type="date" defaultValue={`${year}-01-01`} />
      </Field>
      <Field label="Valid to">
        <Input name="validTo" type="date" defaultValue={`${year}-12-31`} />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create"}</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </form>
  );
}
