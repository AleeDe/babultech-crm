"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLead, updateLead } from "@/server/crm";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
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

  function onSubmit(formData: FormData) {
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
    <form action={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Who is this lead?</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName?.[0]}>
            <Input name="firstName" required defaultValue={defaults?.firstName} />
          </Field>
          <Field label="Last name" required error={fieldErrors.lastName?.[0]}>
            <Input name="lastName" required defaultValue={defaults?.lastName} />
          </Field>
          <Field label="Company" hint="Becomes the account name on conversion.">
            <Input name="companyName" defaultValue={defaults?.companyName ?? ""} />
          </Field>
          <Field label="Job title">
            <Input name="jobTitle" defaultValue={defaults?.jobTitle ?? ""} />
          </Field>
          <Field label="Email" error={fieldErrors.email?.[0]}>
            <Input name="email" type="email" defaultValue={defaults?.email ?? ""} />
          </Field>
          <Field label="Phone">
            <Input name="phone" defaultValue={defaults?.phone ?? ""} />
          </Field>
          <Field label="WhatsApp">
            <Input name="whatsapp" defaultValue={defaults?.whatsapp ?? ""} />
          </Field>
          <Field label="Industry">
            <Input name="industry" defaultValue={defaults?.industry ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where it came from</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Lead source">
            <Select name="leadSource" defaultValue={defaults?.leadSource ?? ""}>
              <option value="">Not stated</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Campaign">
            <Select name="campaignId" defaultValue={defaults?.campaignId ?? ""}>
              <option value="">None</option>
              {options.campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Referred by partner"
            hint="Credits the partner automatically when this lead converts to a deal."
          >
            <Select name="referredByPartnerId" defaultValue={defaults?.referredByPartnerId ?? ""}>
              <option value="">No referral</option>
              {options.partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} ({p.partnerNumber})
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qualification</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Owner" required error={fieldErrors.ownerUserId?.[0]}>
            <Select name="ownerUserId" required defaultValue={defaults?.ownerUserId ?? currentUserId}>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </Select>
          </Field>

          {editing && (
            <Field label="Status" required>
              <Select
                name="status"
                required
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{humanize(s)}</option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Rating">
            <Select name="rating" defaultValue={defaults?.rating ?? ""}>
              <option value="">Not rated</option>
              {RATINGS.map((r) => (
                <option key={r} value={r}>{humanize(r)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Estimated value">
            <Input
              name="estimatedValue"
              type="number"
              step="0.01"
              min="0"
              defaultValue={defaults?.estimatedValue ?? ""}
            />
          </Field>
          <Field label="Next follow-up">
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
              hint="Required — this is what makes lost-lead reporting worth anything."
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
