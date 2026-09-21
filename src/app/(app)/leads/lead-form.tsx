"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLead, updateLead } from "@/server/crm";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { RecordLookup } from "@/components/record-lookup";
import { PicklistOptions } from "@/components/picklist";
import { PicklistSelect } from "@/components/picklist-select";
import { humanize } from "@/lib/utils";

/** CONVERTED is absent by design — a lead becomes converted only through conversion. */
const STATUSES = [
  "NEW", "ASSIGNED", "ATTEMPTED_CONTACT", "CONTACTED", "DISCOVERY_SCHEDULED",
  "QUALIFIED", "NURTURING", "DISQUALIFIED",
];
const RATINGS = ["HOT", "WARM", "COLD"];
const SOURCES = [
  "Website", "Referral", "Partner", "Campaign", "Cold Call",
  "Trade Show", "Social Media", "Inbound Email", "Other",
];

interface Options {
  users: { id: string; fullName: string }[];
  campaigns: { id: string; name: string }[];
  partners: { id: string; displayName: string; partnerNumber: string }[];
}

export interface LeadDefaults {
  id: string;
  /** SALES or PARTNER; what this lead becomes if it converts. */
  leadType?: string | null;
  firstName: string;
  lastName: string;
  companyName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  industry: string | null;
  leadSource: string | null;
  campaignId: string | null;
  referredByPartnerId: string | null;
  ownerUserId: string;
  status: string;
  rating: string | null;
  estimatedValue: string | null;
  description: string | null;
  nextFollowUpAt: string | null;
  disqualifiedReason: string | null;
}

/** "2026-08-10T09:30:00.000Z" -> "2026-08-10T09:30", what datetime-local wants. */
function toLocalInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : "";
}

export function LeadForm({
  options,
  defaults,
  currentUserId,
}: {
  options: Options;
  defaults?: LeadDefaults;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState(defaults?.status ?? "NEW");

  const editing = Boolean(defaults);

  // A submit HANDLER rather than <form action={...}>. React resets a form after
  // an action completes, and every field here is uncontrolled (defaultValue), so
  // with `action` a rejected submit cleared everything the user had typed and
  // made them fill the whole form in again to correct one field.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const base = {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      companyName: get("companyName"),
      jobTitle: get("jobTitle"),
      email: get("email") ?? "",
      phone: get("phone"),
      whatsapp: get("whatsapp"),
      industry: get("industry"),
      leadSource: get("leadSource"),
      campaignId: get("campaignId"),
      referredByPartnerId: get("referredByPartnerId"),
      ownerUserId: String(formData.get("ownerUserId") ?? ""),
      rating: get("rating"),
      estimatedValue: get("estimatedValue"),
      description: get("description"),
      nextFollowUpAt: get("nextFollowUpAt"),
    };

    startTransition(async () => {
      const result = defaults
        ? await updateLead(defaults.id, {
            ...base,
            status: get("status"),
            disqualifiedReason: get("disqualifiedReason"),
          } as never)
        : await createLead(base as never);

      if (result.ok) {
        router.push("/leads");
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
          <CardTitle>Who is this lead?</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Lead type"
              required
              hint="What this becomes if it converts."
              help="A sales lead converts to a customer account. A partner lead converts to an account of type Partner, ready to be linked on the Partners screen."
            >
              <Select name="leadType" required defaultValue={defaults?.leadType ?? "SALES"}>
                <option value="SALES">Sales — a prospective customer</option>
                <option value="PARTNER">Partner — a prospective partner</option>
              </Select>
            </Field>
          </div>
          <Field label="First name" required error={fieldErrors.firstName?.[0]}>
            <Input name="firstName" required defaultValue={defaults?.firstName} />
          </Field>
          <Field label="Last name" required error={fieldErrors.lastName?.[0]}>
            <Input name="lastName" required defaultValue={defaults?.lastName} />
          </Field>
          <Field label="Company" hint="Becomes the account name on conversion."
            help="The organisation they work for. On conversion this becomes the account name, so use the registered business name rather than a shorthand.">
            <Input name="companyName" defaultValue={defaults?.companyName ?? ""} />
          </Field>
          <Field label="Job title"
            help="Their role. Useful for judging whether you are talking to someone who can actually sign.">
            <Input name="jobTitle" defaultValue={defaults?.jobTitle ?? ""} />
          </Field>
          <Field label="Email" error={fieldErrors.email?.[0]}
            help="Their work email. Used for follow-ups and carried across when the lead converts.">
            <Input name="email" type="email" defaultValue={defaults?.email ?? ""} />
          </Field>
          <Field label="Phone"
            help="A direct line. Include the country code if they are outside Pakistan.">
            <Input name="phone" defaultValue={defaults?.phone ?? ""} />
          </Field>
          <Field label="WhatsApp"
            help="Only if it differs from the phone number above. Many customers reply here faster than to email.">
            <Input name="whatsapp" defaultValue={defaults?.whatsapp ?? ""} />
          </Field>
          <Field label="Industry"
            help="The sector they operate in. Used for reporting on where your leads come from.">
            <PicklistSelect list="industry" name="industry" defaultValue={defaults?.industry ?? ""} addLabel="Add an industry" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where it came from</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Lead source"
            help="How they first reached you - a referral, the website, an event. This is what tells you which channels are worth the spend.">
            <PicklistSelect list="lead_source" name="leadSource" emptyLabel="Not stated" fallback={SOURCES} defaultValue={defaults?.leadSource ?? ""} addLabel="Add a lead source" />
          </Field>
          <Field label="Campaign"
            help="The marketing push that produced this lead, if there was one. Links the cost of the campaign to what it returned.">
            <RecordLookup entity="campaign" name="campaignId" defaultValue={defaults?.campaignId ?? ""} emptyLabel="None" />
          </Field>
          <Field
            label="Referred by partner"
            hint="Credits the partner automatically when this lead converts to a deal."
          >
            <RecordLookup entity="partner" name="referredByPartnerId" defaultValue={defaults?.referredByPartnerId ?? ""} emptyLabel="No referral" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qualification</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Owner" required error={fieldErrors.ownerUserId?.[0]}
            help="The person responsible for chasing this lead. They see it in their own list, and nobody else will act on it.">
            <RecordLookup entity="user" name="ownerUserId" defaultValue={defaults?.ownerUserId ?? currentUserId} required />
          </Field>

          {editing && (
            <Field label="Status" required
            help="How far along the conversation is. Move it to Qualified once you believe there is a real deal here.">
              <Select
                name="status"
                required
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <PicklistOptions list="lead_status" fallback={STATUSES} within={STATUSES} current={status} />
              </Select>
            </Field>
          )}

          <Field label="Rating"
            help="Your own judgement of how promising this is. Hot, Warm and Cold are a rough sort, not a formula.">
            <PicklistSelect list="lead_rating" name="rating" emptyLabel="Not rated" fallback={RATINGS} defaultValue={defaults?.rating ?? ""} addLabel="Add a rating" />
          </Field>
          <Field label="Estimated value"
            help="Roughly what the deal is worth if it lands. A guess is fine - it is for sizing the pipeline, not forecasting.">
            <Input
              name="estimatedValue"
              type="number"
              step="0.01"
              min="0"
              defaultValue={defaults?.estimatedValue ?? ""}
            />
          </Field>
          <Field label="Next follow-up"
            help="When you intend to make contact again. It appears on your work list on that date so the lead does not go quiet.">
            <Input
              name="nextFollowUpAt"
              type="datetime-local"
              defaultValue={toLocalInput(defaults?.nextFollowUpAt ?? null)}
            />
          </Field>

          {editing && status === "DISQUALIFIED" && (
            <Field
              label="Disqualified because"
              required
              error={fieldErrors.disqualifiedReason?.[0]}
              hint="Required - this is what makes lost-lead reporting worth anything."
            >
              <Input name="disqualifiedReason" required defaultValue={defaults?.disqualifiedReason ?? ""} />
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea name="description" rows={4} defaultValue={defaults?.description ?? ""} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create lead"}
        </Button>
      </div>
    </form>
  );
}
