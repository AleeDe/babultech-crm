"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, MapPin, Target, UserPlus } from "lucide-react";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea,
} from "@/components/ui";
import { addPartnerOpportunity } from "@/server/partner-customers";

/**
 * A partner recording a deal they are working.
 *
 * The internal deal form, minus what is ours rather than theirs: owner, stage,
 * probability, campaign, lead source, products and pricing. What remains is
 * what the partner knows better than we do — who is buying, where, what type of
 * deal it is, who else is bidding, and what happens next.
 *
 * The buyer can be typed rather than chosen. A partner who has just met
 * somebody should not have to abandon the form, add them as an employee, and
 * start again.
 */
export function AddDealForm({
  accountId,
  accountName,
  contacts,
  currencies,
  dealTypes,
  hasAddress,
}: {
  accountId: string;
  accountName: string;
  contacts: { id: string; firstName: string; lastName: string; jobTitle: string | null }[];
  currencies: { code: string; name: string }[];
  dealTypes: { value: string; label: string }[];
  hasAddress: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [buyerMode, setBuyerMode] = useState<"EXISTING" | "NEW">(
    contacts.length > 0 ? "EXISTING" : "NEW",
  );

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const text = (key: string) => String(fd.get(key) ?? "");
    setError(null);
    setFieldErrors({});

    start(async () => {
      const result = await addPartnerOpportunity({
        accountId,
        name: text("name"),
        amount: fd.get("amount") ? Number(fd.get("amount")) : undefined,
        closeDate: text("closeDate"),
        currencyCode: text("currencyCode") || "PKR",
        contactId: buyerMode === "EXISTING" ? text("contactId") : "",
        notes: text("notes"),
        dealType: text("dealType"),
        nextStep: text("nextStep"),
        competitorName: text("competitorName"),
        newFirstName: buyerMode === "NEW" ? text("newFirstName") : "",
        newLastName: buyerMode === "NEW" ? text("newLastName") : "",
        newJobTitle: buyerMode === "NEW" ? text("newJobTitle") : "",
        newEmail: buyerMode === "NEW" ? text("newEmail") : "",
        newPhone: buyerMode === "NEW" ? text("newPhone") : "",
        street: text("street"),
        city: text("city"),
        state: text("state"),
        postalCode: text("postalCode"),
        country: text("country"),
      });

      if (result.ok) {
        router.push("/portal/deals");
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
            <Target className="h-4 w-4" /> The deal
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What are you selling them?" required error={fieldErrors.name?.[0]}>
              <Input id="name" name="name" required minLength={2} maxLength={255} placeholder="Mobile app build" />
            </Field>
          </div>

          <Field label="Deal type" help="New business, an upgrade to what they already have, or a renewal.">
            <Select id="dealType" name="dealType" defaultValue="NEW">
              {dealTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="Expected value" help="Your best estimate. It can change as the deal develops.">
            <Input id="amount" name="amount" type="number" min="0" step="0.01" />
          </Field>

          <Field label="Currency">
            <Select id="currencyCode" name="currencyCode" defaultValue="PKR">
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Expected close date" help="Leave blank and we will assume 30 days.">
            <Input id="closeDate" name="closeDate" type="date" />
          </Field>

          <Field label="Who else is bidding?" help="Leave blank if nobody, or you do not know.">
            <Input id="competitorName" name="competitorName" maxLength={200} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="What happens next?" help="The next thing that has to happen, and by when. This is what we will chase.">
              <Input id="nextStep" name="nextStep" maxLength={500} placeholder="Demo booked for 3 October" />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> The buyer
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              The person at {accountName} who decides.
            </p>
          </div>
          {contacts.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setBuyerMode(buyerMode === "EXISTING" ? "NEW" : "EXISTING")}
            >
              {buyerMode === "EXISTING" ? "Somebody new" : "Choose from the list"}
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {buyerMode === "EXISTING" ? (
            <div className="sm:col-span-2">
              <Field label="Who is the buyer?">
                <Select id="contactId" name="contactId" defaultValue="">
                  <option value="">Not sure yet</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                      {c.jobTitle ? ` — ${c.jobTitle}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : (
            <>
              <Field label="First name" error={fieldErrors.newFirstName?.[0]}
                help="Give both names, or leave the whole section blank.">
                <Input id="newFirstName" name="newFirstName" maxLength={100} />
              </Field>
              <Field label="Last name" error={fieldErrors.newLastName?.[0]}>
                <Input id="newLastName" name="newLastName" maxLength={100} />
              </Field>
              <Field label="Job title">
                <Input id="newJobTitle" name="newJobTitle" maxLength={150} />
              </Field>
              <Field label="Email" error={fieldErrors.newEmail?.[0]}>
                <Input id="newEmail" name="newEmail" type="email" maxLength={255} />
              </Field>
              <Field label="Phone">
                <Input id="newPhone" name="newPhone" maxLength={50} />
              </Field>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Where they are
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasAddress
              ? `We already have an address for ${accountName}, so anything here is ignored. Tell us on the Activities thread if it has changed.`
              : "Their address, if you have it. It goes on the customer record, not just this deal."}
          </p>
        </CardHeader>
        {!hasAddress && (
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Street">
                <Input id="street" name="street" maxLength={255} />
              </Field>
            </div>
            <Field label="City">
              <Input id="city" name="city" maxLength={100} />
            </Field>
            <Field label="State or province">
              <Input id="state" name="state" maxLength={100} />
            </Field>
            <Field label="Postal code">
              <Input id="postalCode" name="postalCode" maxLength={30} />
            </Field>
            <Field label="Country">
              <Input id="country" name="country" maxLength={100} defaultValue="Pakistan" />
            </Field>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Anything else
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Notes" help="What they need, where you are in the conversation, anything we should know before we speak to them.">
            <Textarea id="notes" name="notes" rows={4} maxLength={2000} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create deal"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/portal/customers")} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
