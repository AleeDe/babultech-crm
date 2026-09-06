"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProject, updateProject } from "@/server/projects";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { humanize } from "@/lib/utils";

const STATUSES = ["DRAFT", "PLANNING", "ACTIVE", "ON_HOLD", "AT_RISK", "COMPLETED", "CANCELLED"];
const HEALTH = ["GREEN", "AMBER", "RED"];
const BILLING = ["FIXED", "HOURLY", "RETAINER", "MILESTONE", "ANNUAL"];

export interface ProjectFormOptions {
  accounts: { id: string; name: string }[];
  users: { id: string; fullName: string; jobTitle: string | null }[];
  opportunities: { id: string; opportunityNumber: string; name: string; accountId: string }[];
  contracts: { id: string; contractNumber: string; accountId: string }[];
  currencies: { code: string; name: string }[];
}

export interface ProjectDefaults {
  id: string;
  name: string;
  projectType: string;
  accountId: string | null;
  opportunityId: string | null;
  contractId: string | null;
  projectManagerId: string;
  status: string;
  health: string;
  billingType: string;
  startDate: string | null;
  plannedEndDate: string | null;
  contractValue: string | null;
  currencyCode: string;
  approvedHours: string | null;
  scope: string | null;
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function ProjectForm({
  options,
  defaults,
  currentUserId,
  lockedAccountId,
}: {
  options: ProjectFormOptions;
  defaults?: ProjectDefaults;
  currentUserId: string;
  lockedAccountId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [accountId, setAccountId] = useState(defaults?.accountId ?? lockedAccountId ?? "");
  const [projectType, setProjectType] = useState(defaults?.projectType ?? "CUSTOMER");
  const internal = projectType === "INTERNAL";
  const [billingType, setBillingType] = useState(defaults?.billingType ?? "FIXED");

  const editing = Boolean(defaults);

  // Only the customer's own won deals and contracts can source their project.
  const accountOpportunities = useMemo(
    () => options.opportunities.filter((o) => o.accountId === accountId),
    [options.opportunities, accountId],
  );
  const accountContracts = useMemo(
    () => options.contracts.filter((c) => c.accountId === accountId),
    [options.contracts, accountId],
  );

  function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const input = {
      name: String(formData.get("name") ?? ""),
      projectType,
      accountId: internal ? null : accountId,
      opportunityId: get("opportunityId"),
      contractId: get("contractId"),
      projectManagerId: String(formData.get("projectManagerId") ?? ""),
      status: get("status"),
      health: get("health"),
      billingType,
      startDate: get("startDate"),
      plannedEndDate: get("plannedEndDate"),
      actualEndDate: null,
      contractValue: get("contractValue"),
      currencyCode: get("currencyCode"),
      approvedHours: get("approvedHours"),
      scope: get("scope"),
    } as never;

    startTransition(async () => {
      const result = defaults
        ? await updateProject(defaults.id, input)
        : await createProject(input);

      if (result.ok) {
        router.push(`/projects/${result.data.id}`);
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
          <CardTitle>Engagement</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Who is this work for?" required
            hint={lockedAccountId ? "Started from a customer's page." : undefined}
            help="Customer work is delivered to an account and can be billed to them. Internal work is our own - our products, tooling, R&D - so it has no customer, no deal and no contract.">
            <Select
              name="projectType"
              required
              value={projectType}
              disabled={Boolean(lockedAccountId)}
              onChange={(e) => setProjectType(e.target.value)}
            >
              <option value="CUSTOMER">A customer</option>
              <option value="INTERNAL">BabulTech itself (internal)</option>
            </Select>
          </Field>
          <Field label="Project name" required error={fieldErrors.name?.[0]}
            help={internal
              ? "What the work is called. Use the name your team would recognise."
              : "What the work is called. Use the name the customer would recognise."}>
            <Input
              name="name"
              required
              defaultValue={defaults?.name}
              placeholder={internal ? "BabulTech CRM - v2" : "Acme - ERP implementation"}
            />
          </Field>
          {!internal && (
            <Field label="Customer" required error={fieldErrors.accountId?.[0]}
              help="The account this work is delivered to.">
              <Select
                name="accountId"
                required
                value={accountId}
                disabled={Boolean(lockedAccountId)}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Select a customer…</option>
                {options.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Project manager" required error={fieldErrors.projectManagerId?.[0]}
            hint="Added to the team automatically so they can book time."
            help="Who runs the project. They see it in their own list and approve time booked against it.">
            <Select
              name="projectManagerId"
              required
              defaultValue={defaults?.projectManagerId ?? currentUserId}
            >
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}{u.jobTitle ? `, ${u.jobTitle}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {!internal && (
            <>
              <Field label="Sourced from deal" hint={accountId ? "Won deals for this customer." : "Pick a customer first."}
                help="The opportunity this project came out of, if it was sold. Links the delivery back to the sale.">
                <Select name="opportunityId" defaultValue={defaults?.opportunityId ?? ""} disabled={!accountId}>
                  <option value="">None</option>
                  {accountOpportunities.map((o) => (
                    <option key={o.id} value={o.id}>{o.opportunityNumber} - {o.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Contract"
                help="The signed contract this work is delivered under, if there is one.">
                <Select name="contractId" defaultValue={defaults?.contractId ?? ""} disabled={!accountId}>
                  <option value="">None</option>
                  {accountContracts.map((c) => (
                    <option key={c.id} value={c.id}>{c.contractNumber}</option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule and status</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status" required
            help="Where the project stands. Planning, active, on hold, or finished.">
            <Select name="status" required defaultValue={defaults?.status ?? "DRAFT"}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Health" required hint="Your judgement, not a calculation."
            help="A traffic light for how delivery is actually going, separate from status. A project can be Active and Red at the same time - that is the point.">
            <Select name="health" required defaultValue={defaults?.health ?? "GREEN"}>
              {HEALTH.map((h) => (
                <option key={h} value={h}>{humanize(h)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Start date"
            help="When work begins or began.">
            <Input name="startDate" type="date" defaultValue={dateInput(defaults?.startDate ?? null)} />
          </Field>
          <Field label="Planned end" error={fieldErrors.plannedEndDate?.[0]}
            help="When it is due to finish. Compared against the actual end date to spot slippage.">
            <Input name="plannedEndDate" type="date" defaultValue={dateInput(defaults?.plannedEndDate ?? null)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Commercials</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Billing type" required
            hint={internal ? "Internal work is not billed; this only shapes how effort is tracked." : undefined}
            help={internal
              ? "Internal work raises no invoice. The choice still decides whether effort is tracked against a fixed budget, by the hour, or against milestones."
              : "How the customer pays: a fixed price, by the hour, a retainer, or against milestones."}>
            <Select
              name="billingType"
              required
              value={billingType}
              onChange={(e) => setBillingType(e.target.value)}
            >
              {BILLING.map((b) => (
                <option key={b} value={b}>{humanize(b)}</option>
              ))}
            </Select>
          </Field>
          {internal ? (
            <Field label="Budget"
              hint="Not billed to anyone."
              help="What this work is expected to cost us in total. Recorded so internal spend can be tracked, never invoiced.">
              <Input
                name="contractValue"
                type="number"
                step="0.01"
                min="0"
                defaultValue={defaults?.contractValue ?? ""}
              />
            </Field>
          ) : (
            <Field label="Contract value"
              help="What the customer is paying in total.">
              <Input
                name="contractValue"
                type="number"
                step="0.01"
                min="0"
                defaultValue={defaults?.contractValue ?? ""}
              />
            </Field>
          )}
          <Field label="Currency" required
            help="The currency the project is billed in.">
            <Select name="currencyCode" required defaultValue={defaults?.currencyCode ?? "PKR"}>
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Approved hours"
            hint="The budget burn-down is measured against this."
            help="The hours budgeted. Time booked beyond this shows as an overrun rather than being silently absorbed."
          >
            <Input
              name="approvedHours"
              type="number"
              step="0.5"
              min="0"
              defaultValue={defaults?.approvedHours ?? ""}
            />
          </Field>

          {billingType === "MILESTONE" && !internal && (
            <div className="sm:col-span-2 lg:col-span-4">
              <Alert tone="info">
                Milestone billing - mark the milestones that trigger an invoice on the project
                workspace, and give each one an amount or a percentage of the contract value.
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scope</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            name="scope"
            rows={5}
            defaultValue={defaults?.scope ?? ""}
            placeholder={internal
              ? "What is in scope, what is explicitly out, and which team owns what."
              : "What is in scope, what is explicitly out, and what the customer is responsible for."}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create project"}
        </Button>
      </div>
    </form>
  );
}
