"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MailCheck, MailX, Trash2, UserPlus } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import {
  setEmailOptOut, deleteCampaignMember, convertMemberToLead,
} from "@/server/campaign-members";

/**
 * The things that are not ordinary edits.
 *
 * Converting puts somebody into the sales pipeline, unsubscribing applies to
 * every campaign for good, and removing takes them off every future audience.
 * None belongs among the text fields, where any of them could be done by
 * tabbing past it.
 */
export function MemberActions({
  id,
  name,
  optedOut,
  convertedLeadId,
}: {
  id: string;
  name: string;
  optedOut: boolean;
  convertedLeadId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function convert() {
    if (
      !window.confirm(
        `Create a lead from ${name}?\n\nEverything on this record is copied across, ` +
          `including the campaign they came from, so the campaign stays credited.`,
      )
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const result = await convertMemberToLead(id);
      if (result.ok) {
        // Straight to the lead: converting is the start of working them, and the
        // next thing anybody wants is the record they will work in.
        router.push(`/leads/${result.data.leadId}`);
        router.refresh();
      } else setError(result.error);
    });
  }

  function toggleOptOut() {
    const resubscribing = optedOut;
    if (
      !window.confirm(
        resubscribing
          ? `Put ${name} back on the email list? Only do this if they have asked to come back.`
          : `Unsubscribe ${name} from every email campaign?`,
      )
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const result = await setEmailOptOut(id, !optedOut);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function remove() {
    if (!window.confirm(`Remove ${name} from the campaign list?`)) return;
    setError(null);
    start(async () => {
      const result = await deleteCampaignMember(id);
      if (result.ok) {
        router.push("/campaign-members");
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {!convertedLeadId && (
          <Button onClick={convert} disabled={pending}>
            <UserPlus className="h-4 w-4" />
            {pending ? "Working…" : "Convert to lead"}
          </Button>
        )}
        <Button variant="outline" onClick={toggleOptOut} disabled={pending}>
          {optedOut ? (
            <>
              <MailCheck className="h-4 w-4" /> Put back on the email list
            </>
          ) : (
            <>
              <MailX className="h-4 w-4" /> Unsubscribe from emails
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          onClick={remove}
          disabled={pending}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" /> Remove
        </Button>
      </div>
    </div>
  );
}
