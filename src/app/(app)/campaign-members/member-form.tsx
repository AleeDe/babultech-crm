"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, MapPin, User } from "lucide-react";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Textarea,
} from "@/components/ui";
import { PicklistSelect } from "@/components/picklist-select";
import { saveCampaignMember, type CampaignMember } from "@/server/campaign-members";

/**
 * One campaign member.
 *
 * Business type and company size are picklists with a + on the field, like
 * every other list in the application — a marketing list grows new categories
 * constantly and nobody should wait on a migration to record one.
 */
export function CampaignMemberForm({ defaults }: { defaults?: CampaignMember | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const text = (key: string) => String(fd.get(key) ?? "");
    setError(null);
    setFieldErrors({});

    start(async () => {
      const result = await saveCampaignMember({
        id: defaults?.id ?? null,
        firstName: text("firstName"),
        lastName: text("lastName"),
        email: text("email"),
        phone: text("phone"),
        whatsapp: text("whatsapp"),
        companyName: text("companyName"),
        website: text("website"),
        businessType: text("businessType"),
        companySize: text("companySize"),
        street: text("street"),
        city: text("city"),
        state: text("state"),
        postalCode: text("postalCode"),
        country: text("country"),
        source: text("source"),
        notes: text("notes"),
        active: fd.get("active") !== null,
      });

      if (result.ok) {
        router.push(`/campaign-members/${result.data.id}`);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4" /> The person
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName?.[0]}>
            <Input id="firstName" name="firstName" required maxLength={100} defaultValue={defaults?.firstName ?? ""} />
          </Field>
          <Field label="Last name">
            <Input id="lastName" name="lastName" maxLength={100} defaultValue={defaults?.lastName ?? ""} />
          </Field>
          <Field
            label="Email"
            error={fieldErrors.email?.[0]}
            help="Also how we recognise somebody already on the list, so an import does not add them twice."
          >
            <Input id="email" name="email" type="email" maxLength={255} defaultValue={defaults?.email ?? ""} />
          </Field>
          <Field label="Contact number">
            <Input id="phone" name="phone" maxLength={50} defaultValue={defaults?.phone ?? ""} />
          </Field>
          <Field label="WhatsApp number" help="Leave blank if it is the same as the contact number.">
            <Input id="whatsapp" name="whatsapp" maxLength={50} defaultValue={defaults?.whatsapp ?? ""} />
          </Field>
          <Field label="Where they came from" help="The list, event or referral this person came off.">
            <Input id="source" name="source" maxLength={100} defaultValue={defaults?.source ?? ""} placeholder="Trade show, October" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Their company
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <Input id="companyName" name="companyName" maxLength={200} defaultValue={defaults?.companyName ?? ""} />
          </Field>
          <Field label="Website">
            <Input id="website" name="website" maxLength={255} defaultValue={defaults?.website ?? ""} placeholder="https://" />
          </Field>
          <Field label="Business type" help="What they do. Add a type with the + if the one you want is missing.">
            <PicklistSelect
              list="business_type"
              name="businessType"
              defaultValue={defaults?.businessType ?? ""}
              addLabel="Add a business type"
            />
          </Field>
          <Field label="Company size" help="Roughly how big they are.">
            <PicklistSelect
              list="company_size"
              name="companySize"
              defaultValue={defaults?.companySize ?? ""}
              addLabel="Add a size"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Address
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street">
              <Input id="street" name="street" maxLength={255} defaultValue={defaults?.street ?? ""} />
            </Field>
          </div>
          <Field label="City">
            <Input id="city" name="city" maxLength={100} defaultValue={defaults?.city ?? ""} />
          </Field>
          <Field label="State or province">
            <Input id="state" name="state" maxLength={100} defaultValue={defaults?.state ?? ""} />
          </Field>
          <Field label="Postal code">
            <Input id="postalCode" name="postalCode" maxLength={30} defaultValue={defaults?.postalCode ?? ""} />
          </Field>
          <Field label="Country">
            <Input id="country" name="country" maxLength={100} defaultValue={defaults?.country ?? "Pakistan"} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Anything worth remembering" help="What they were interested in, who introduced you, what they said.">
            <Textarea id="notes" name="notes" rows={3} maxLength={4000} defaultValue={defaults?.notes ?? ""} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              id="active"
              type="checkbox"
              name="active"
              defaultChecked={defaults?.active ?? true}
              className="h-4 w-4 rounded border-input"
            />
            On the active list
            <span className="text-xs text-muted-foreground">
              Turn this off to keep somebody on file without including them in campaigns.
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : defaults ? "Save member" : "Create member"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/campaign-members")}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
