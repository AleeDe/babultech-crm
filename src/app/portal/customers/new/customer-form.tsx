"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Building2, Info, UserPlus } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea,
} from "@/components/ui";
import { humanize } from "@/lib/utils";
import {
  checkCustomerConflict, createPartnerCustomer,
  type RegistrationConflict,
} from "@/server/partner-customers";

/**
 * A partner registering a customer they have won.
 *
 * The conflict check runs when the company name loses focus rather than on
 * every keystroke — a partner types a name once, and a check per character
 * would be both wasteful and a way to probe the customer list quickly.
 *
 * A conflict never blocks the form. The partner is told, shown who holds the
 * relationship, and left to decide whether to carry on; if they do, the record
 * is created and flagged for a human. Refusing outright would only mean the
 * clash goes unrecorded and gets discovered at invoicing instead.
 */
export function PartnerCustomerForm({ currencies }: { currencies: { code: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [checking, setChecking] = useState(false);
  const [conflict, setConflict] = useState<RegistrationConflict | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [withDeal, setWithDeal] = useState(false);

  const [form, setForm] = useState({
    accountName: "", firstName: "", lastName: "", email: "", phone: "",
    jobTitle: "", industry: "", city: "", website: "",
    dealName: "", dealAmount: "", dealCloseDate: "", dealCurrency: "PKR", notes: "",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function runConflictCheck() {
    if (form.accountName.trim().length < 2) return;
    setChecking(true);
    setRevealed(false);
    const result = await checkCustomerConflict({
      accountName: form.accountName,
      email: form.email,
      phone: form.phone,
    });
    setChecking(false);
    setConflict(result.ok && result.data.conflict ? result.data : null);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    start(async () => {
      const result = await createPartnerCustomer({
        ...form,
        dealName: withDeal ? form.dealName : "",
        dealAmount: withDeal && form.dealAmount ? Number(form.dealAmount) : undefined,
        dealCloseDate: withDeal ? form.dealCloseDate : "",
        dealCurrency: withDeal ? form.dealCurrency : undefined,
      });

      if (result.ok) {
        router.push(`/portal/customers?created=${result.data.accountNumber}`);
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

      {conflict && (
        <Alert tone={conflict.mine ? "info" : "warning"}>
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              {conflict.mine
                ? "You have already registered this customer."
                : "A customer like this already exists."}
            </p>
            <p className="text-sm">
              {conflict.mine
                ? "Adding them again would create a duplicate. Open your customers to find them."
                : "You can still register them, but the relationship may already belong to someone else. We will look into it and come back to you."}
            </p>

            {!revealed ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setRevealed(true)}>
                <Info className="h-4 w-4" /> Give me details
              </Button>
            ) : (
              <div className="rounded-md border bg-card p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <Building2 className="h-4 w-4" />
                  {conflict.accountName}
                  {conflict.accountType && (
                    <Badge tone="neutral">{humanize(conflict.accountType)}</Badge>
                  )}
                </p>
                <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {conflict.city && (
                    <div><dt className="inline font-medium">Location: </dt><dd className="inline">{conflict.city}</dd></div>
                  )}
                  {conflict.customerStatus && (
                    <div><dt className="inline font-medium">Status: </dt><dd className="inline">{humanize(conflict.customerStatus)}</dd></div>
                  )}
                  {conflict.registeredOn && (
                    <div><dt className="inline font-medium">On our books since: </dt><dd className="inline">{conflict.registeredOn}</dd></div>
                  )}
                  <div>
                    <dt className="inline font-medium">Brought by: </dt>
                    <dd className="inline">
                      {conflict.broughtBy === "you"
                        ? "you"
                        : conflict.broughtBy
                          ? conflict.broughtBy
                          : "us directly"}
                    </dd>
                  </div>
                </dl>
                {!conflict.mine && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Contact details are not shown for a customer that is not yours. Speak to your
                    partner manager if you believe this is your relationship.
                  </p>
                )}
                {conflict.mine && (
                  <Link href="/portal/customers" className="mt-2 inline-block text-xs underline">
                    Open your customers
                  </Link>
                )}
              </div>
            )}
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> The company
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Company name"
              required
              error={fieldErrors.accountName?.[0]}
              help="We check this against customers we already know as soon as you move on."
            >
              <Input
                id="accountName"
                value={form.accountName}
                onChange={(e) => set("accountName", e.target.value)}
                onBlur={runConflictCheck}
                required
                minLength={2}
                maxLength={200}
              />
            </Field>
            {checking && <p className="mt-1 text-xs text-muted-foreground">Checking…</p>}
          </div>
          <Field label="Industry" help="What they do. Helps us route them to the right team.">
            <Input id="industry" value={form.industry} onChange={(e) => set("industry", e.target.value)} maxLength={100} />
          </Field>
          <Field label="City">
            <Input id="city" value={form.city} onChange={(e) => set("city", e.target.value)} maxLength={100} />
          </Field>
          <Field label="Website">
            <Input id="website" type="url" value={form.website} onChange={(e) => set("website", e.target.value)} maxLength={255} placeholder="https://" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Who you deal with there
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Their main contact. You can add more people once the customer is created.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName?.[0]}>
            <Input id="firstName" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} required maxLength={100} />
          </Field>
          <Field label="Last name" required error={fieldErrors.lastName?.[0]}>
            <Input id="lastName" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} required maxLength={100} />
          </Field>
          <Field label="Job title">
            <Input id="jobTitle" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} maxLength={150} />
          </Field>
          <Field label="Email" error={fieldErrors.email?.[0]} help="Also checked against customers we already know.">
            <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} onBlur={runConflictCheck} maxLength={255} />
          </Field>
          <Field label="Phone" help="Any format. We compare the digits, so spacing does not matter.">
            <Input id="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} onBlur={runConflictCheck} maxLength={50} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>The first deal</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional. Add it now if you know what you are selling them, or later from their page.
            </p>
          </div>
          <Button type="button" variant={withDeal ? "secondary" : "outline"} onClick={() => setWithDeal(!withDeal)}>
            {withDeal ? "Skip the deal" : "Add a deal"}
          </Button>
        </CardHeader>
        {withDeal && (
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="What are you selling them?" required={withDeal}>
                <Input id="dealName" value={form.dealName} onChange={(e) => set("dealName", e.target.value)} maxLength={255} placeholder="Mobile app build" />
              </Field>
            </div>
            <Field label="Expected value" help="Your best estimate. It can change as the deal develops.">
              <Input id="dealAmount" type="number" min="0" step="0.01" value={form.dealAmount} onChange={(e) => set("dealAmount", e.target.value)} />
            </Field>
            <Field label="Currency">
              <Select id="dealCurrency" value={form.dealCurrency} onChange={(e) => set("dealCurrency", e.target.value)}>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Expected close date" help="Leave blank and we will assume 30 days.">
              <Input id="dealCloseDate" type="date" value={form.dealCloseDate} onChange={(e) => set("dealCloseDate", e.target.value)} />
            </Field>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anything we should know</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Notes" help="Context that will not fit the fields above — who introduced you, what they need, what they have tried.">
            <Textarea id="notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create customer"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/portal/customers")} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
