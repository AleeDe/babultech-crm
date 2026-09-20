"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { raiseTicket } from "@/server/support-portal";

const PRIORITIES = [
  ["LOW", "Low — a question, or something minor"],
  ["MEDIUM", "Normal — something is wrong but we can work"],
  ["HIGH", "High — an important part is not working"],
  ["CRITICAL", "Urgent — we are stopped"],
] as const;

/** What a customer fills in to raise a ticket. */
export function TicketForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});

    start(async () => {
      const result = await raiseTicket({
        subject: String(fd.get("subject") ?? ""),
        description: String(fd.get("description") ?? ""),
        priority: String(fd.get("priority") ?? "MEDIUM") as never,
      });
      if (result.ok) {
        router.push(`/support/tickets/${result.data.id}`);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="What is the problem?" required error={fieldErrors.subject?.[0]}
        help="A short title, so we can recognise it at a glance.">
        <Input name="subject" required maxLength={200} placeholder="Cannot print the daily sales report" />
      </Field>

      <Field label="Tell us what is happening" required error={fieldErrors.description?.[0]}
        help="What you were doing, what you expected, and what happened instead. Any error message helps.">
        <Textarea
          name="description"
          required
          rows={8}
          placeholder="Since this morning, printing the daily sales report shows 'no printer found' on till 2. Till 1 prints normally."
        />
      </Field>

      <Field label="How urgent is it?" required
        help="Be honest — it decides how quickly this reaches someone.">
        <Select name="priority" defaultValue="MEDIUM">
          {PRIORITIES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Raise ticket"}</Button>
      </div>
    </form>
  );
}
