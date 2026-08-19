"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { submitDealRegistration } from "@/server/portal";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";

const INDUSTRIES = [
  "Manufacturing", "Textiles", "Retail", "Logistics", "Healthcare",
  "Education", "Financial Services", "Government", "IT Services", "Other",
];

export function RegisterForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState<{ leadNumber: string; contested: boolean; message: string } | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    startTransition(async () => {
      const result = await submitDealRegistration({
        companyName: String(formData.get("companyName") ?? ""),
        firstName: String(formData.get("firstName") ?? ""),
        lastName: String(formData.get("lastName") ?? ""),
        email: get("email") ?? "",
        phone: get("phone"),
        industry: get("industry"),
        estimatedValue: get("estimatedValue"),
        expectedCloseDate: get("expectedCloseDate"),
        description: String(formData.get("description") ?? ""),
      } as never);

      if (result.ok) {
        setDone(result.data);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  if (done) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-100 dark:bg-emerald-950">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Registration received</h2>
            <p className="mt-1 text-sm text-muted-foreground">{done.message}</p>
            <p className="mt-2 font-mono text-sm">{done.leadNumber}</p>
          </div>

          {done.contested && (
            <Alert tone="warning">
              We already hold a record for this customer, so this registration is contested. Nothing
              is decided automatically — your partner manager will confirm who it belongs to.
            </Alert>
          )}

          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/portal/referrals">See my referrals</Link>
            </Button>
            <Button onClick={() => setDone(null)}>Register another</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Alert tone="info">
        Registering tells us you are working this customer. It does not create a deal on its own —
        your partner manager reviews it first. Once it is qualified and converted, you are attached
        to the resulting deal automatically and commission follows your plan.
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>The customer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Company name"
              required
              error={fieldErrors.companyName?.[0]}
              hint="Use their registered name — it is what we check for an existing registration against."
            help="The prospective customer's company name."
            >
              <Input name="companyName" required placeholder="Zenith Textiles (Pvt) Ltd" />
            </Field>
          </div>
          <Field label="Industry"
            help="The sector they operate in.">
            <Select name="industry" defaultValue="">
              <option value="">Not sure</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </Select>
          </Field>
          <Field label="Estimated value" hint="Your best guess is fine."
            help="Roughly what the deal is worth. A guess is fine.">
            <Input name="estimatedValue" type="number" step="1000" min="0" placeholder="500000" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your contact there</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName?.[0]}
            help="Given name of your contact there.">
            <Input name="firstName" required />
          </Field>
          <Field label="Last name" required error={fieldErrors.lastName?.[0]}
            help="Family name of your contact.">
            <Input name="lastName" required />
          </Field>
          <Field label="Email" error={fieldErrors.email?.[0]}
            help="Their email address.">
            <Input name="email" type="email" placeholder="name@company.com" />
          </Field>
          <Field label="Phone"
            help="A contact number.">
            <Input name="phone" placeholder="+92 300 1234567" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The opportunity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Expected close date" hint="Roughly when you think they will decide."
            help="When you expect them to decide.">
            <Input name="expectedCloseDate" type="date" className="sm:w-56" />
          </Field>
          <Field
            label="What do they need?"
            required
            error={fieldErrors.description?.[0]}
            hint="What problem they have, what you have discussed, and where they are in their thinking. The more you give us, the faster this moves."
            help="What the customer is actually asking for, so the team can pick it up without going back to you."
          >
            <Textarea name="description" rows={6} required />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Register this deal"}
        </Button>
      </div>
    </form>
  );
}
