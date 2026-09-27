"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea,
} from "@/components/ui";
import { SaveError } from "@/components/save-error";
import type { DuplicateRef } from "@/lib/duplicates";
import { humanize } from "@/lib/utils";
import {
  savePartnerLead, type PartnerLead, type PartnerLeadInput, type PartnerPicklists,
} from "@/server/partner-leads";

/** CONVERTED is absent by design: a lead becomes converted only by converting it. */
const STATUSES = [
  "NEW", "ASSIGNED", "ATTEMPTED_CONTACT", "CONTACTED", "DISCOVERY_SCHEDULED",
  "QUALIFIED", "NURTURING", "DISQUALIFIED",
] as const;

const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");

/**
 * A partner's lead: who they are, where they work, and how warm they are.
 *
 * The same fields our team's lead form has, less the ones that are ours to
 * decide - the owner, the campaign and which partner it belongs to.
 */
export function PartnerLeadForm({
  lead,
  picklists,
}: {
  lead?: PartnerLead;
  picklists: PartnerPicklists;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [duplicate, setDuplicate] = useState<DuplicateRef | undefined>();
  const [status, setStatus] = useState(lead?.status ?? "NEW");

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "");

    setError(null);
    setFieldErrors({});
    setDuplicate(undefined);

    const input: PartnerLeadInput = {
      firstName: get("firstName"),
      lastName: get("lastName"),
      companyName: get("companyName"),
      jobTitle: get("jobTitle"),
      email: get("email"),
      phone: get("phone"),
      whatsapp: get("whatsapp"),
      industry: get("industry"),
      website: get("website"),
      businessType: get("businessType"),
      companySize: get("companySize"),
      street: get("street"),
      city: get("city"),
      state: get("state"),
      postalCode: get("postalCode"),
      country: get("country"),
      leadSource: get("leadSource"),
      rating: get("rating"),
      estimatedValue: get("estimatedValue") as never,
      description: get("description"),
      nextFollowUpAt: get("nextFollowUpAt"),
      ...(lead ? { status: status as PartnerLeadInput["status"], disqualifiedReason: get("disqualifiedReason") } : {}),
    };

    start(async () => {
      const result = await savePartnerLead(lead?.id ?? null, input);
      if (result.ok) {
        router.push(`/portal/leads/${result.data.id}`);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        setDuplicate(result.duplicate);
      }
    });
  }

  const pick = (name: string, list: { value: string; label: string }[], current: string | null | undefined, empty: string) => (
    <Select name={name} defaultValue={current ?? ""}>
      <option value="">{empty}</option>
      {list.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
      {/* A value no longer on the list stays choosable rather than silently cleared. */}
      {current && !list.some((o) => o.value === current) && <option value={current}>{humanize(current)}</option>}
    </Select>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <SaveError error={error} duplicate={duplicate} />

      <Card>
        <CardHeader>
          <CardTitle>Who is this lead?</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName?.[0]}>
            <Input name="firstName" required maxLength={100} defaultValue={lead?.firstName ?? ""} />
          </Field>
          <Field label="Last name" required error={fieldErrors.lastName?.[0]}>
            <Input name="lastName" required maxLength={100} defaultValue={lead?.lastName ?? ""} />
          </Field>
          <Field label="Company">
            <Input name="companyName" maxLength={200} defaultValue={lead?.companyName ?? ""} />
          </Field>
          <Field label="Job title">
            <Input name="jobTitle" maxLength={150} defaultValue={lead?.jobTitle ?? ""} />
          </Field>
          <Field label="Email" error={fieldErrors.email?.[0]}
            help="Nobody already in our records can be added twice - by email, phone or WhatsApp.">
            <Input name="email" type="email" maxLength={255} defaultValue={lead?.email ?? ""} />
          </Field>
          <Field label="Phone" error={fieldErrors.phone?.[0]}>
            <Input name="phone" maxLength={50} defaultValue={lead?.phone ?? ""} />
          </Field>
          <Field label="WhatsApp" error={fieldErrors.whatsapp?.[0]}>
            <Input name="whatsapp" maxLength={50} defaultValue={lead?.whatsapp ?? ""} />
          </Field>
          <Field label="Website">
            <Input name="website" maxLength={255} defaultValue={lead?.website ?? ""} />
          </Field>
          <Field label="Industry">{pick("industry", picklists.industry, lead?.industry, "Not stated")}</Field>
          <Field label="Business type">{pick("businessType", picklists.business_type, lead?.businessType, "Not stated")}</Field>
          <Field label="Company size">{pick("companySize", picklists.company_size, lead?.companySize, "Not stated")}</Field>
          <Field label="Lead source">{pick("leadSource", picklists.lead_source, lead?.leadSource ?? (lead ? null : "Partner"), "Not stated")}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where they are</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street">
              <Input name="street" maxLength={255} defaultValue={lead?.street ?? ""} />
            </Field>
          </div>
          <Field label="City"><Input name="city" maxLength={100} defaultValue={lead?.city ?? ""} /></Field>
          <Field label="State or province"><Input name="state" maxLength={100} defaultValue={lead?.state ?? ""} /></Field>
          <Field label="Postal code"><Input name="postalCode" maxLength={30} defaultValue={lead?.postalCode ?? ""} /></Field>
          <Field label="Country"><Input name="country" maxLength={100} defaultValue={lead?.country ?? ""} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How warm</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lead && (
            <Field label="Status" required>
              <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{humanize(s)}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Rating">{pick("rating", picklists.lead_rating, lead?.rating, "Not rated")}</Field>
          <Field label="Estimated value" error={fieldErrors.estimatedValue?.[0]} help="What you think the deal could be worth.">
            <Input name="estimatedValue" type="number" min="0" step="0.01" defaultValue={lead?.estimatedValue != null ? String(lead.estimatedValue) : ""} />
          </Field>
          <Field label="Next follow-up" help="When you will next be in touch. It shows on your lead list.">
            <Input name="nextFollowUpAt" type="datetime-local" defaultValue={toLocalInput(lead?.nextFollowUpAt ?? null)} />
          </Field>
          {lead && status === "DISQUALIFIED" && (
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Why disqualified" required error={fieldErrors.disqualifiedReason?.[0]}>
                <Input name="disqualifiedReason" required maxLength={255} defaultValue={lead?.disqualifiedReason ?? ""} />
              </Field>
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Notes">
              <Textarea name="description" rows={4} maxLength={8000} defaultValue={lead?.description ?? ""} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : lead ? "Save changes" : "Create lead"}
        </Button>
      </div>
    </form>
  );
}
