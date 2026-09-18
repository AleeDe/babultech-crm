"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitClientDecision } from "@/server/client-review";

/**
 * The client's decision. Deliberately plain: no CRM styling, no jargon, and
 * nothing that assumes the reader knows how the agency works internally.
 */
export function DecisionForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState("APPROVED");

  return (
    <form
      className="mt-5 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        start(async () => {
          const result = await submitClientDecision({
            token,
            decision,
            approver: String(form.get("approver") ?? ""),
            comments: String(form.get("comments") ?? ""),
          });
          if (result.ok) router.refresh();
          else setError(result.error);
        });
      }}
    >
      <fieldset className="space-y-2" disabled={pending}>
        <legend className="text-sm font-medium">Is this approved?</legend>
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <input
            type="radio"
            name="decision"
            value="APPROVED"
            checked={decision === "APPROVED"}
            onChange={() => setDecision("APPROVED")}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Approved</span>
            <span className="block text-sm text-muted-foreground">
              This is ready to go out as written.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <input
            type="radio"
            name="decision"
            value="CHANGES_REQUESTED"
            checked={decision === "CHANGES_REQUESTED"}
            onChange={() => setDecision("CHANGES_REQUESTED")}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Needs changes</span>
            <span className="block text-sm text-muted-foreground">
              The team will make changes and send a new version.
            </span>
          </span>
        </label>
      </fieldset>

      <label className="block">
        <span className="text-sm font-medium">Your name</span>
        <input
          name="approver"
          required
          maxLength={200}
          disabled={pending}
          autoComplete="name"
          className="mt-1 w-full rounded-md border px-3 py-2"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">
          {decision === "APPROVED" ? "Anything to add" : "What needs to change"}
        </span>
        <textarea
          name="comments"
          required
          maxLength={4000}
          rows={5}
          disabled={pending}
          className="mt-1 w-full rounded-md border px-3 py-2"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Recording…" : "Record my decision"}
      </button>

      <p className="text-xs text-muted-foreground">
        Your name and comment are recorded against this version, and are visible to the team working
        on it.
      </p>
    </form>
  );
}
