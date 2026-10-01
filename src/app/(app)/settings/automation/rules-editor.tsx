"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@/components/ui";
import {
  saveApprovalRule, deleteApprovalRule, saveAutomationRule,
  type ApprovalRule, type AutomationRule,
} from "@/server/automation";

const money = (n: number | null) => (n == null ? "" : n.toLocaleString("en-PK"));

export function ApprovalRulesEditor({ rules }: { rules: ApprovalRule[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", minTotal: "", maxLineDiscountPercent: "" });

  const add = () =>
    start(async () => {
      setError(null);
      const result = await saveApprovalRule({
        id: null,
        name: draft.name,
        minTotal: draft.minTotal ? Number(draft.minTotal.replace(/,/g, "")) : null,
        maxLineDiscountPercent: draft.maxLineDiscountPercent ? Number(draft.maxLineDiscountPercent) : null,
        active: true,
      });
      if (!result.ok) return setError(result.error);
      setDraft({ name: "", minTotal: "", maxLineDiscountPercent: "" });
      router.refresh();
    });

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const result = await fn();
      if (!result.ok && "error" in result) window.alert(result.error);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quote approval rules</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          A quote over any active limit goes to Approvals before it can be sent. Changing an approved quote&apos;s total sends it back for approval.
          Quotes partners prepare always need approval.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rules: our own quotes can be sent without approval.</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{r.name}</span>{" "}
                  {!r.active && <Badge tone="neutral">Off</Badge>}
                  <span className="block text-xs text-muted-foreground">
                    {[r.minTotal != null && `Total over ${money(r.minTotal)}`, r.maxLineDiscountPercent != null && `Any line discounted over ${r.maxLineDiscountPercent}%`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => saveApprovalRule({ ...r, active: !r.active }))}>
                    {r.active ? "Switch off" : "Switch on"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(`Delete "${r.name}"?`) && act(() => deleteApprovalRule(r.id))}>
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="New rule">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Large quotes" maxLength={150} />
          </Field>
          <Field label="Total over (PKR)">
            <Input inputMode="decimal" value={draft.minTotal} onChange={(e) => setDraft({ ...draft, minTotal: e.target.value })} placeholder="500,000" />
          </Field>
          <Field label="Any line discount over (%)">
            <Input inputMode="decimal" value={draft.maxLineDiscountPercent} onChange={(e) => setDraft({ ...draft, maxLineDiscountPercent: e.target.value })} placeholder="15" />
          </Field>
          <Button onClick={add} disabled={pending}>Add rule</Button>
        </div>
      </CardContent>
    </Card>
  );
}

const DESCRIPTIONS: Record<string, { title: string; help: string }> = {
  LEAD_ROUND_ROBIN: { title: "Share website leads in turn", help: "Leads from website forms go to the people chosen below, one after another, instead of the form's owner." },
  LEAD_NO_FOLLOW_UP: { title: "No follow-up date", help: "Tell the owner about an open lead with no next follow-up date, once a week, after this many days." },
  DEAL_STALE: { title: "Deal not moving", help: "Tell the owner about an open deal nothing has changed on for this many days." },
  CASE_RESPONSE_WARNING: { title: "First response due soon", help: "Tell the owner when a case's first-response deadline is this many minutes away and nobody has replied." },
};

function RuleCard({ rule, users }: { rule: AutomationRule; users: { id: string; fullName: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [number, setNumber] = useState(String(rule.config.days ?? rule.config.minutes ?? ""));
  const [pool, setPool] = useState<string[]>((rule.config.userIds as string[] | undefined) ?? []);
  const d = DESCRIPTIONS[rule.key] ?? { title: rule.key, help: "" };

  const save = () =>
    start(async () => {
      setMessage(null);
      const config =
        rule.key === "LEAD_ROUND_ROBIN" ? { userIds: pool }
        : rule.key === "CASE_RESPONSE_WARNING" ? { minutes: Number(number) }
        : { days: Number(number) };
      const result = await saveAutomationRule({ key: rule.key, enabled, config } as never);
      setMessage(result.ok ? { tone: "success", text: "Saved." } : { tone: "danger", text: result.error });
      if (result.ok) router.refresh();
    });

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{d.title}</p>
          <p className="text-sm text-muted-foreground">{d.help}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label={`${d.title} on`} />
          On
        </label>
      </div>
      {rule.key === "LEAD_ROUND_ROBIN" ? (
        <div className="grid gap-1 sm:grid-cols-3">
          {users.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={pool.includes(u.id)}
                onChange={(e) => setPool((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))}
              />
              {u.fullName}
            </label>
          ))}
        </div>
      ) : (
        <div className="w-40">
          <Field label={rule.key === "CASE_RESPONSE_WARNING" ? "Minutes before" : "Days"}>
            <Input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} aria-label={`${d.title} ${rule.key === "CASE_RESPONSE_WARNING" ? "minutes" : "days"}`} />
          </Field>
        </div>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </div>
  );
}

export function AutomationRulesEditor({ rules, users }: { rules: AutomationRule[]; users: { id: string; fullName: string }[] }) {
  const order = ["LEAD_ROUND_ROBIN", "LEAD_NO_FOLLOW_UP", "DEAL_STALE", "CASE_RESPONSE_WARNING"];
  const sorted = [...rules].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Automatic rules</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Checked every ten minutes. Reminders arrive under the bell as &quot;Reminders from rules&quot;, and each action is listed below.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        {sorted.map((r) => <RuleCard key={r.key} rule={r} users={users} />)}
      </CardContent>
    </Card>
  );
}
