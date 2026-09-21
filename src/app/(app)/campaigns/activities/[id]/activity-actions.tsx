"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { deleteCampaignActivity } from "@/server/campaign-activities";

/**
 * Edit and delete, offered only while an activity is still a plan.
 *
 * A completed activity is a record of what was sent to whom; editing its
 * subject line would make that record disagree with what people actually read,
 * and deleting it would take its audience's history with it.
 */
export function ActivityActions({
  id,
  name,
  campaignId,
  status,
}: {
  id: string;
  name: string;
  campaignId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editable = !["RUNNING", "COMPLETED"].includes(status);

  function remove() {
    if (!window.confirm(`Delete "${name}"? Its audience list goes with it.`)) return;
    setError(null);
    start(async () => {
      const result = await deleteCampaignActivity(id);
      if (result.ok) {
        router.push(`/campaigns/${campaignId}`);
        router.refresh();
      } else setError(result.error);
    });
  }

  if (!editable) return null;

  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button asChild size="sm" variant="outline">
        <Link href={`/campaigns/activities/${id}/edit`}>
          <Pencil className="h-4 w-4" /> Edit
        </Link>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={remove}
        disabled={pending}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" /> Delete
      </Button>
    </>
  );
}
