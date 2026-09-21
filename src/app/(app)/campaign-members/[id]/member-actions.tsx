"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MailCheck, MailX, Trash2 } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { setEmailOptOut, deleteCampaignMember } from "@/server/campaign-members";

/**
 * The two things that are not ordinary edits.
 *
 * Unsubscribing applies to every campaign for good, and removing somebody takes
 * them off every future audience — neither belongs among the text fields, where
 * either could be done by tabbing past it.
 */
export function MemberActions({
  id,
  name,
  optedOut,
}: {
  id: string;
  name: string;
  optedOut: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
