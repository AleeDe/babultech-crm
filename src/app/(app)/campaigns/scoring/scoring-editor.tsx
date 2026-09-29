"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";
import { INTERACTION_TYPES, interactionLabel } from "@/lib/marketing";
import { saveScoreRule, deleteScoreRule, saveScoreSetting, type ScoreRule } from "@/server/lead-scoring";

const FIELDS = [
  { value: "jobTitle", label: "Job title" },
  { value: "companySize", label: "Company size" },
  { value: "industry", label: "Industry" },
  { value: "businessType", label: "Business type" },
  { value: "country", label: "Country" },
  { value: "city", label: "City" },
  { value: "leadSource", label: "Lead source" },
  { value: "email", label: "Email address" },
];

function describe(r: ScoreRule): string {
  if (r.ruleType === "TOUCH") return `Each "${interactionLabel(r.interactionType ?? "")}" in the last 90 days (up to 5)`;
  if (r.ruleType === "FIELD") return `${FIELDS.find((f) => f.value === r.field)?.label ?? r.field} contains "${r.matchText}"`;
  return `Nothing has happened for ${r.days} days`;
}

const BLANK: ScoreRule = { id: "", name: "", ruleType: "TOUCH", interactionType: "FORM_SUBMIT", field: "jobTitle", matchText: "", days: 30, points: 10, active: true };

export function ScoringEditor({
  rules,
  threshold,
  autoQualify,
  canEdit,
}: {
  rules: ScoreRule[];
  threshold: number;
  autoQualify: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<ScoreRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [th, setTh] = useState(String(threshold));
  const [auto, setAuto] = useState(autoQualify);
  const [saved, setSaved] = useState<string | null>(null);

  const saveRule = () =>
    start(async () => {
      if (!editing) return;
      setError(null);
      const result = await saveScoreRule({
        id: editing.id || null,
        name: editing.name,
        ruleType: editing.ruleType,
        interactionType: editing.ruleType === "TOUCH" ? editing.interactionType : null,
        field: editing.ruleType === "FIELD" ? (editing.field as never) : null,
        matchText: editing.ruleType === "FIELD" ? editing.matchText : null,
        days: editing.ruleType === "INACTIVE" ? Number(editing.days) : null,
        points: Number(editing.points),
        active: editing.active,
      });
      if (!result.ok) return setError(result.error);
      setEditing(null);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>When a lead is hot</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          {saved && <div className="w-full"><Alert tone="success">{saved}</Alert></div>}
          <div className="w-40">
            <Field label="Threshold (points)">
              <Input type="number" min={1} max={1000} value={th} onChange={(e) => setTh(e.target.value)} disabled={!canEdit} />
            </Field>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={auto} disabled={!canEdit} onChange={(e) => setAuto(e.target.checked)} />
            Move a prospect to New when it reaches the threshold
          </label>
          {canEdit && (
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await saveScoreSetting({ threshold: Number(th), autoQualify: auto });
                  setSaved(result.ok ? "Saved." : result.error);
                })
              }
            >
              Save
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Rules</CardTitle>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setEditing({ ...BLANK })}>Add a rule</Button>}
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <THead>
              <TR>
                <TH>Rule</TH>
                <TH priority="secondary">When</TH>
                <TH className="text-right">Points</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {rules.map((r) => (
                <TR key={r.id}>
                  <TD className="text-sm font-medium">
                    {r.name} {!r.active && <Badge tone="neutral">Off</Badge>}
                  </TD>
                  <TD className="text-sm text-muted-foreground" priority="secondary">{describe(r)}</TD>
                  <TD className={`text-right text-sm font-semibold tabular-nums ${r.points < 0 ? "text-destructive" : ""}`}>
                    {r.points > 0 ? `+${r.points}` : r.points}
                  </TD>
                  <TD className="text-right">
                    {canEdit && (
                      <span className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ ...r })}>Edit</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => {
                            if (!window.confirm(`Delete "${r.name}"? Every lead is re-scored.`)) return;
                            start(async () => {
                              const result = await deleteScoreRule(r.id);
                              if (!result.ok) window.alert(result.error);
                              router.refresh();
                            });
                          }}
                        >
                          Delete
                        </Button>
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="px-5 pt-3 text-xs text-muted-foreground">
            Scores are recalculated whenever a lead is touched or changed, every night, and for every lead when a rule changes.
          </p>
        </CardContent>
      </Card>

      <FormDialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)} title={editing?.id ? "Edit rule" : "Add a rule"}>
        {editing && (
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Name" required>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={150} />
            </Field>
            <Field label="Kind">
              <Select value={editing.ruleType} onChange={(e) => setEditing({ ...editing, ruleType: e.target.value as ScoreRule["ruleType"] })}>
                <option value="TOUCH">Something they did</option>
                <option value="FIELD">Something about them</option>
                <option value="INACTIVE">Gone quiet</option>
              </Select>
            </Field>
            {editing.ruleType === "TOUCH" && (
              <Field label="Touch">
                <Select value={editing.interactionType ?? ""} onChange={(e) => setEditing({ ...editing, interactionType: e.target.value })}>
                  {INTERACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
            )}
            {editing.ruleType === "FIELD" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Field">
                  <Select value={editing.field ?? ""} onChange={(e) => setEditing({ ...editing, field: e.target.value })}>
                    {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </Select>
                </Field>
                <Field label="Contains">
                  <Input value={editing.matchText ?? ""} onChange={(e) => setEditing({ ...editing, matchText: e.target.value })} maxLength={100} />
                </Field>
              </div>
            )}
            {editing.ruleType === "INACTIVE" && (
              <Field label="After how many days">
                <Input type="number" min={1} max={3650} value={editing.days ?? 30} onChange={(e) => setEditing({ ...editing, days: Number(e.target.value) })} />
              </Field>
            )}
            <Field label="Points" help="Negative takes points off.">
              <Input type="number" min={-100} max={100} value={editing.points} onChange={(e) => setEditing({ ...editing, points: Number(e.target.value) })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              In use
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveRule} disabled={pending}>{pending ? "Saving…" : "Save rule"}</Button>
            </div>
          </div>
        )}
      </FormDialog>
    </div>
  );
}
