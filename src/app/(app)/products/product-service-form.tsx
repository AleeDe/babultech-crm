"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Package, Wrench, ListChecks } from "lucide-react";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
} from "@/components/ui";
import { RecordLookup } from "@/components/record-lookup";
import { RichTextEditor } from "@/components/rich-text-editor";
import { saveProductService } from "@/server/products-services";

interface Defaults {
  id: string;
  name: string;
  productCode: string;
  productType: "PRODUCT" | "SERVICE";
  addInTask: boolean;
  active: boolean;
  description: string | null;
  ownerAccountId: string | null;
}

/**
 * One product or service.
 *
 * The type is chosen as two large options rather than a dropdown, because it
 * decides everything else about the item - its code prefix, whether it can be
 * sold in hours, whether it ever becomes project work - and a dropdown makes a
 * consequential choice look like a minor one.
 *
 * Add in Task only appears for a Service. The database refuses it on a Product
 * anyway; hiding it means nobody is offered a choice that cannot be made.
 */
export function ProductServiceForm({
  defaults,
  typeLocked = false,
}: {
  defaults?: Defaults;
  /** True once it is priced or sold: the type can no longer change. */
  typeLocked?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [type, setType] = useState<"PRODUCT" | "SERVICE">(defaults?.productType ?? "SERVICE");
  const [addInTask, setAddInTask] = useState(defaults?.addInTask ?? false);

  function submit(fd: FormData) {
    setError(null);
    setFieldErrors({});
    start(async () => {
      const result = await saveProductService({
        id: defaults?.id ?? null,
        name: String(fd.get("name") ?? ""),
        productType: type,
        addInTask: type === "SERVICE" && addInTask,
        active: fd.get("active") !== null,
        description: String(fd.get("description") ?? ""),
        ownerAccountId: String(fd.get("ownerAccountId") ?? ""),
      });

      if (result.ok) {
        router.push(`/products/${result.data.id}`);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  const typeOption = (value: "PRODUCT" | "SERVICE", title: string, detail: string, Icon: typeof Package) => {
    const chosen = type === value;
    return (
      <label
        className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
          chosen ? "border-primary bg-primary/5" : "hover:bg-muted/40"
        } ${typeLocked && !chosen ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <input
          type="radio"
          name="productType"
          value={value}
          checked={chosen}
          disabled={typeLocked}
          onChange={() => setType(value)}
          className="mt-1"
        />
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        </div>
      </label>
    );
  };

  return (
    <form action={submit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>What it is</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Name" required error={fieldErrors.name?.[0]}>
            <Input name="name" required maxLength={200} defaultValue={defaults?.name ?? ""} autoFocus={!defaults} />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium">Type</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {typeOption("PRODUCT", "Product", "Software or anything licensed. Coded P-000001.", Package)}
              {typeOption("SERVICE", "Service", "Work we do. Coded S-000001, and can be sold in hours.", Wrench)}
            </div>
            {typeLocked ? (
              <p className="mt-2 text-xs text-muted-foreground">
                The type is locked: this is already priced in a book or sold on a deal. Changing it now
                would re-classify history, so create a new one instead.
              </p>
            ) : (
              defaults && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Changing the type issues a new code. Once this is priced or sold, it can no longer change.
                </p>
              )
            )}
            {fieldErrors.productType?.[0] && (
              <p className="mt-2 text-sm text-destructive">{fieldErrors.productType[0]}</p>
            )}
          </div>

          {type === "SERVICE" && (
            <label className="flex cursor-pointer gap-3 rounded-lg border p-4 hover:bg-muted/40">
              <input
                type="checkbox"
                checked={addInTask}
                onChange={(e) => setAddInTask(e.target.checked)}
                className="mt-1"
              />
              <ListChecks className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Add in Task</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Sold in hours. On a deal, its quantity is a number of hours, and when the deal is won
                  those hours become a task on the delivery project. Leave off for recurring services such as
                  Hosting or Support.
                </p>
              </div>
            </label>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={defaults?.active ?? true} />
            Active — can be added to price books and deals
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Owner"
            help="Whose product or service this is. Leave blank for our own; choose a partner's account for one of theirs."
          >
            <RecordLookup
              entity="account"
              name="ownerAccountId"
              defaultValue={defaults?.ownerAccountId ?? ""}
              emptyLabel="BabulTech (us)"
            />
          </Field>
          <Field label="Description" help="What it is, what is included, and anything a salesperson should know.">
            <RichTextEditor name="description" defaultValue={defaults?.description ?? ""} rows={8} />
          </Field>
        </CardContent>
      </Card>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : defaults ? "Save changes" : "Create"}
      </Button>
    </form>
  );
}
