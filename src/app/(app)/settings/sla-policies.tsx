"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Timer, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  Table, THead, TBody, TR, TH, TD, Input, Select, Button, Alert, Badge, statusTone,
} from "@/components/ui";
import { saveSlaPolicy, deleteSlaPolicy, type SlaPolicyRow } from "@/server/sla";
import { humanize } from "@/lib/utils";

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

/** Minutes as something a person reads: 240 → "4h", 2880 → "2d". */
function readable(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  }
  const days = minutes / 1440;
  return Number.isInteger(days) ? `${days}d` : `${days.toFixed(1)}d`;
}

/**
 * Response and resolution targets per priority.
 *
 * The empty state says plainly what an empty table means, because "no policies"
 * does not read as "every case is being created with no deadline" — and that is
 * exactly what it means.
 */
export function SlaPolicies({
  policies,
  businessHours,
}: {
  policies: SlaPolicyRow[];
  businessHours: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setError(result.error ?? "That did not work.");
        // A refused delete may still have deactivated the policy.
        router.refresh();
      }
    });
  }

  function save(formData: FormData, id?: string) {
    run(
      () =>
        saveSlaPolicy({
          id: id ?? "",
          name: String(formData.get("name") ?? ""),
          priority: String(formData.get("priority") ?? "MEDIUM") as never,
          firstResponseMinutes: Number(formData.get("firstResponseMinutes") ?? 0),
          resolutionMinutes: Number(formData.get("resolutionMinutes") ?? 0),
          businessHoursId: String(formData.get("businessHoursId") ?? "") || null,
          pauseOnCustomerWait: formData.get("pauseOnCustomerWait") === "on",
          active: formData.get("active") === "on",
        }),
      () => {
        setAdding(false);
        setEditing(null);
      },
    );
  }

  const missing = PRIORITIES.filter(
    (p) => !policies.some((policy) => policy.priority === p && policy.active),
  );

  const form = (policy?: SlaPolicyRow) => (
    <form
      action={(formData) => save(formData, policy?.id)}
      className="space-y-3 rounded-lg border bg-muted/30 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="name" defaultValue={policy?.name ?? ""} placeholder="Critical - 1h / 8h" required />
        <Select name="priority" defaultValue={policy?.priority ?? "MEDIUM"}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {humanize(p)}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">First response (minutes)</label>
          <Input
            name="firstResponseMinutes"
            type="number"
            min="1"
            defaultValue={policy?.firstResponseMinutes ?? 60}
            required
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Resolution (minutes)</label>
          <Input
            name="resolutionMinutes"
            type="number"
            min="1"
            defaultValue={policy?.resolutionMinutes ?? 480}
            required
          />
        </div>
      </div>

      {businessHours.length > 0 && (
        <Select name="businessHoursId" defaultValue={policy?.businessHours?.id ?? ""}>
          <option value="">Round the clock</option>
          {businessHours.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name="pauseOnCustomerWait"
              defaultChecked={policy?.pauseOnCustomerWait ?? true}
            />
            Pause while waiting on the customer
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="active" defaultChecked={policy?.active ?? true} />
            Active
          </label>
        </div>
        <div className="flex gap-1">
          <Button type="submit" size="sm" disabled={pending}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdding(false);
              setEditing(null);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </form>
  );

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            Service level targets
          </CardTitle>
          <CardDescription>
            How quickly a case must be answered and closed, by priority. Every case picks up the
            active policy for its priority when it is raised.
          </CardDescription>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {adding ? "Cancel" : "Add"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {missing.length > 0 && (
          <Alert tone="warning">
            No active policy for{" "}
            <strong>{missing.map((p) => p.toLowerCase()).join(", ")}</strong>. Cases raised at
            {missing.length === 1 ? " that priority" : " those priorities"} get no deadline at all:
            they will never show as overdue and never appear as breaching.
          </Alert>
        )}

        {adding && form()}

        {policies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No policies yet. Until one exists for a priority, cases at that priority are created
            with no response or resolution deadline.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Policy</TH>
                <TH>Priority</TH>
                <TH className="text-right">First response</TH>
                <TH className="text-right">Resolution</TH>
                <TH>Clock</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {policies.map((p) =>
                editing === p.id ? (
                  <TR key={p.id}>
                    <TD colSpan={7} className="bg-muted/20">
                      {form(p)}
                    </TD>
                  </TR>
                ) : (
                  <TR key={p.id} className={p.active ? undefined : "opacity-60"}>
                    <TD className="font-medium">{p.name}</TD>
                    <TD>
                      <Badge tone={statusTone(p.priority)}>{humanize(p.priority)}</Badge>
                    </TD>
                    <TD className="text-right tabular">{readable(p.firstResponseMinutes)}</TD>
                    <TD className="text-right tabular">{readable(p.resolutionMinutes)}</TD>
                    <TD className="text-xs text-muted-foreground">
                      {p.businessHours?.name ?? "Round the clock"}
                      {p.pauseOnCustomerWait && (
                        <span className="block">Pauses on customer wait</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={p.active ? "success" : "neutral"}>
                        {p.active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <button
                        onClick={() => setEditing(p.id)}
                        aria-label={`Edit ${p.name}`}
                        className="mr-2 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => run(() => deleteSlaPolicy(p.id))}
                        disabled={pending}
                        aria-label={`Remove ${p.name}`}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TD>
                  </TR>
                ),
              )}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
