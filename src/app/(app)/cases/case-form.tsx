"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createCase, updateCase } from "@/server/cases";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { humanize } from "@/lib/utils";

const TYPES = ["INCIDENT", "REQUEST", "QUESTION", "PROBLEM"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SOURCES = ["EMAIL", "PORTAL", "PHONE", "WHATSAPP", "INTERNAL"];
const STATUSES = [
  "NEW", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CUSTOMER",
  "WAITING_FOR_INTERNAL_TEAM", "WAITING_FOR_THIRD_PARTY",
  "RESOLVED", "CLOSED", "REOPENED", "CANCELLED",
];
const CLOSING = ["RESOLVED", "CLOSED"];

export interface CaseFormOptions {
  accounts: { id: string; name: string }[];
  contacts: { id: string; firstName: string; lastName: string; email: string | null; accountId: string | null }[];
  users: { id: string; fullName: string }[];
  teams: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  slaPolicies: {
    id: string;
    name: string;
    priority: string;
    firstResponseMinutes: number;
    resolutionMinutes: number;
  }[];
}

export interface CaseDefaults {
  id: string;
  caseNumber: string;
  subject: string;
  description: string;
  accountId: string;
  contactId: string | null;
  categoryId: string | null;
  ownerUserId: string | null;
  teamId: string | null;
  caseType: string;
  priority: string;
  source: string;
  status: string;
  rootCause: string | null;
  resolution: string | null;
  satisfactionScore: number | null;
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function CaseForm({
  options,
  defaults,
  lockedAccountId,
}: {
  options: CaseFormOptions;
  defaults?: CaseDefaults;
  lockedAccountId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [accountId, setAccountId] = useState(defaults?.accountId ?? lockedAccountId ?? "");
  const [contactId, setContactId] = useState(defaults?.contactId ?? "");
  const [priority, setPriority] = useState(defaults?.priority ?? "MEDIUM");
  const [status, setStatus] = useState(defaults?.status ?? "NEW");

  const editing = Boolean(defaults);

  // A case always belongs to a contact *of that account* — so the contact list
  // is derived from the chosen account, never shown whole.
  const accountContacts = useMemo(
    () => options.contacts.filter((c) => c.accountId === accountId),
    [options.contacts, accountId],
  );

  const sla = useMemo(
    () => options.slaPolicies.find((p) => p.priority === priority),
    [options.slaPolicies, priority],
  );

  function onAccountChange(next: string) {
    setAccountId(next);
    setContactId(""); // the old contact belongs to a different company
  }

  function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const base = {
      subject: String(formData.get("subject") ?? ""),
      description: String(formData.get("description") ?? ""),
      accountId,
      contactId,
      categoryId: get("categoryId"),
      ownerUserId: get("ownerUserId"),
      teamId: get("teamId"),
      slaPolicyId: get("slaPolicyId"),
      projectId: null,
      contractId: null,
      caseType: get("caseType"),
      priority,
      source: get("source"),
    };

    startTransition(async () => {
      const result = defaults
        ? await updateCase(defaults.id, {
            ...base,
            status,
            rootCause: get("rootCause"),
            resolution: get("resolution"),
            satisfactionScore: get("satisfactionScore"),
          } as never)
        : await createCase(base as never);

      if (result.ok) {
        router.push(`/cases/${result.data.id}`);
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
          <CardTitle>Who is affected</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" required error={fieldErrors.accountId?.[0]}
            help="The account reporting the issue.">
            <Select
              name="accountId"
              required
              value={accountId}
              disabled={Boolean(lockedAccountId)}
              onChange={(e) => onAccountChange(e.target.value)}
            >
              <option value="">Select a customer…</option>
              {options.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Contact"
            required
            error={fieldErrors.contactId?.[0]}
            hint={
              accountId
                ? "Only people at the selected customer are listed."
                : "Choose a customer first."
            }
            help="The individual who raised it. They get the updates."
          >
            <Select
              name="contactId"
              required
              value={contactId}
              disabled={!accountId}
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">Select a contact…</option>
              {accountContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                  {c.email ? ` — ${c.email}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          {accountId && accountContacts.length === 0 && (
            <div className="sm:col-span-2">
              <Alert tone="warning">
                This customer has no contacts yet, and a case must be raised for a person.{" "}
                <Link href={`/contacts/new?accountId=${accountId}`} className="underline">
                  Add a contact for them
                </Link>{" "}
                first.
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The problem</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Subject" required error={fieldErrors.subject?.[0]}
            help="A one-line summary of the problem. This is what appears in every list, so make it specific.">
            <Input
              name="subject"
              required
              defaultValue={defaults?.subject}
              placeholder="Invoices not generating for the Karachi branch"
            />
          </Field>
          <Field label="Description" required error={fieldErrors.description?.[0]}
            help="What the customer actually reported, in their words where possible.">
            <Textarea
              name="description"
              rows={5}
              required
              defaultValue={defaults?.description}
              placeholder="What the customer reported, what they expected, and what actually happened."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Type" required
            help="The kind of issue — a fault, a question, a request. Decides how it is routed and reported.">
              <Select name="caseType" required defaultValue={defaults?.caseType ?? "INCIDENT"}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{humanize(t)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" required
            help="How urgent this is. Combined with the SLA policy, it sets the clock you are working against.">
              <Select
                name="priority"
                required
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{humanize(p)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Came in via" required
            help="How the customer reported it — email, phone, the portal. Useful for knowing which channels to staff.">
              <Select name="source" required defaultValue={defaults?.source ?? "EMAIL"}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{humanize(s)}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Category"
              hint={options.categories.length === 0 ? "No categories configured yet." : undefined}
            help="A finer classification within the type. Used to spot patterns across many cases."
            >
              <Select name="categoryId" defaultValue={defaults?.categoryId ?? ""}>
                <option value="">Uncategorised</option>
                {options.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          {sla && !editing && (
            <Alert tone="info">
              <strong>{sla.name}</strong> applies at {humanize(priority)} priority — first response
              due in {minutesLabel(sla.firstResponseMinutes)}, resolution in{" "}
              {minutesLabel(sla.resolutionMinutes)}. These are elapsed hours, not business hours.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assignment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Owner"
            error={fieldErrors.ownerUserId?.[0]}
            hint="An open case needs an owner or a team."
            help="Who is handling it. It appears in their work list."
          >
            <Select name="ownerUserId" defaultValue={defaults?.ownerUserId ?? ""}>
              <option value="">Unassigned</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Team"
            help="The team responsible, when it is not down to one person.">
            <Select name="teamId" defaultValue={defaults?.teamId ?? ""}>
              <option value="">No team</option>
              {options.teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="SLA policy" hint="Left blank, the policy matching the priority is used."
            help="The response and resolution targets this case is held to. Picked from the policies in Settings.">
            <Select name="slaPolicyId" defaultValue="">
              <option value="">Match on priority</option>
              {options.slaPolicies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({humanize(p.priority)})
                </option>
              ))}
            </Select>
          </Field>

          {editing && (
            <Field label="Status" required
            help="Where the case stands. Moving it to Resolved stops the SLA timer.">
              <Select name="status" required value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{humanize(s)}</option>
                ))}
              </Select>
            </Field>
          )}
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>Outcome</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Root cause"
            help="What was actually wrong, once you know. Filled in as the case is worked, not when it is raised.">
              <Textarea name="rootCause" rows={3} defaultValue={defaults?.rootCause ?? ""} />
            </Field>
            <Field
              label="Resolution"
              required={CLOSING.includes(status)}
              error={fieldErrors.resolution?.[0]}
              hint="Required before a case can be resolved or closed."
            help="What you did to fix it. This is what someone reads when the same problem comes back."
            >
              <Textarea name="resolution" rows={3} defaultValue={defaults?.resolution ?? ""} />
            </Field>
            <Field label="Satisfaction score" hint="1–5, as reported by the customer."
            help="How the customer rated the outcome, if they told you.">
              <Input
                name="satisfactionScore"
                type="number"
                min="1"
                max="5"
                className="w-32"
                defaultValue={defaults?.satisfactionScore ?? ""}
              />
            </Field>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || (!editing && accountContacts.length === 0)}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create case"}
        </Button>
      </div>
    </form>
  );
}
