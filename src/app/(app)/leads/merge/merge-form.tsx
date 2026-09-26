"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Check } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui";
import { MERGEABLE_FIELDS } from "@/lib/mergeable-fields";
import { mergeLeads, type DuplicateLead } from "@/server/lead-merge";
import { formatDate } from "@/lib/utils";

/**
 * Field-by-field merge.
 *
 * Per field rather than per record, because neither record is reliably the
 * better one: a trade-show scan often has the mobile number while the web form
 * has the job title. Picking a winner and discarding the rest loses whichever
 * details the loser happened to hold.
 *
 * The most complete record is pre-selected as the survivor, and for each field
 * the first non-empty value is pre-selected - so the common case is to read it
 * over and press Merge, and the work is only in the fields that disagree.
 */
export function MergeForm({ leads }: { leads: DuplicateLead[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Most complete wins; ties go to the older record, which is usually the one
  // colleagues have already been looking at.
  const suggested = useMemo(
    () =>
      [...leads].sort(
        (a, b) =>
          b.completeness - a.completeness ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0],
    [leads],
  );

  const [survivorId, setSurvivorId] = useState(suggested.id);

  const valueOf = (lead: DuplicateLead, key: string) => {
    const v = (lead as unknown as Record<string, unknown>)[key];
    return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  };

  /**
   * Which lead each field takes its value from.
   *
   * Recomputed when the survivor changes, because the survivor's own values
   * should be the starting point - otherwise switching survivor silently keeps
   * choices made against the other record.
   */
  const initialChoices = useMemo(() => {
    const choices: Record<string, string> = {};
    for (const field of MERGEABLE_FIELDS) {
      const survivorValue = valueOf(
        leads.find((l) => l.id === survivorId)!,
        field.key,
      );
      if (survivorValue) {
        choices[field.key] = survivorId;
        continue;
      }
      // The survivor has nothing here, so offer the first record that does.
      const filled = leads.find((l) => valueOf(l, field.key));
      choices[field.key] = filled?.id ?? survivorId;
    }
    return choices;
  }, [leads, survivorId]);

  const [choices, setChoices] = useState<Record<string, string>>(initialChoices);
  const [choiceKey, setChoiceKey] = useState(survivorId);

  // Switching survivor resets the field choices. Done during render rather than
  // in an effect so the radio buttons never paint a stale selection first.
  if (choiceKey !== survivorId) {
    setChoiceKey(survivorId);
    setChoices(initialChoices);
  }

  const losers = leads.filter((l) => l.id !== survivorId);

  // Only fields where two records hold DIFFERENT values need a decision. Where
  // one is blank there is nothing to weigh - the filled one is taken - and
  // showing it as a choice would bury the handful that matter in a list of
   // forty. Those are collapsed below, described as settled rather than agreed:
  // a blank is not agreement, and one of these values may be coming from the
  // record that is about to be retired.
  const contested = MERGEABLE_FIELDS.filter((field) => {
    const values = new Set(leads.map((l) => valueOf(l, field.key)).filter(Boolean));
    return values.size > 1;
  });
  const settled = MERGEABLE_FIELDS.filter((f) => !contested.includes(f));

  function submit() {
    const count = losers.length;
    if (
      !window.confirm(
        `Merge ${count} ${count === 1 ? "lead" : "leads"} into ` +
          `${leads.find((l) => l.id === survivorId)!.firstName}?\n\n` +
          `Everything attached to them moves across. The merged records are ` +
          `retired, not deleted, so this can be seen afterwards.`,
      )
    ) {
      return;
    }

    setError(null);
    const values: Record<string, string> = {};
    for (const field of MERGEABLE_FIELDS) {
      const from = leads.find((l) => l.id === choices[field.key]);
      if (from) values[field.key] = valueOf(from, field.key);
    }

    start(async () => {
      const result = await mergeLeads({
        survivorId,
        loserIds: losers.map((l) => l.id),
        values,
      });

      if (result.ok) {
        router.push(`/leads/${result.data.survivorId}`);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Which record do you want to keep?</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            The one you keep keeps its lead number, its owner and its status. The others are
            retired.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {leads.map((lead) => (
            <label
              key={lead.id}
              className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                survivorId === lead.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="survivor"
                  value={lead.id}
                  checked={survivorId === lead.id}
                  onChange={() => setSurvivorId(lead.id)}
                  className="mt-1"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {lead.firstName} {lead.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{lead.leadNumber}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {formatDate(lead.createdAt)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Badge tone="neutral">{lead.completeness} fields</Badge>
                    {lead.id === suggested.id && <Badge tone="success">Most complete</Badge>}
                  </div>
                </div>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {contested.length === 0
              ? "Nothing to choose between"
              : contested.length === 1
                ? "1 field disagrees"
                : `${contested.length} fields disagree`}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {contested.length === 0
              ? "No two records hold different values for the same field. Merging simply brings everything together."
              : "Pick the value to keep for each. The rest are settled already and are listed further down."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {contested.map((field) => (
            <div key={field.key} className="rounded-md border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {field.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {leads.map((lead) => {
                  const value = valueOf(lead, field.key);
                  const chosen = choices[field.key] === lead.id;
                  return (
                    <label
                      key={lead.id}
                      className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        chosen ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`field-${field.key}`}
                        checked={chosen}
                        onChange={() =>
                          setChoices((prev) => ({ ...prev, [field.key]: lead.id }))
                        }
                        className="sr-only"
                      />
                      {chosen && <Check className="mr-1 inline h-3.5 w-3.5" />}
                      {value || <span className="text-muted-foreground">(empty)</span>}
                      <span className="ml-2 text-xs text-muted-foreground">{lead.leadNumber}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          {settled.length > 0 && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {settled.length} field{settled.length === 1 ? "" : "s"} with nothing to choose
                <span className="ml-1 font-normal text-muted-foreground">
                  (only one record has a value, or they match)
                </span>
              </summary>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {settled.map((field) => {
                  const value =
                    leads.map((l) => valueOf(l, field.key)).find(Boolean) ?? "";
                  return (
                    <div key={field.key} className="text-sm">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {field.label}
                      </dt>
                      <dd>{value || <span className="text-muted-foreground">—</span>}</dd>
                    </div>
                  );
                })}
              </dl>
            </details>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={pending}>
          <GitMerge className="h-4 w-4" />
          {pending
            ? "Merging…"
            : `Merge ${losers.length} into this record`}
        </Button>
        <p className="text-sm text-muted-foreground">
          Notes, emails, logged calls and the campaign members behind every record move across.
        </p>
      </div>
    </div>
  );
}
