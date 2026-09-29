"use client";

import { useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui";
import { setFollowing } from "@/server/notifications";
import type { FollowableType } from "@/lib/notification-kinds";

/**
 * Follow a record to hear about the changes that matter on it - stage,
 * status, owner, notes, a customer's reply - under the bell.
 */
export function FollowButton({
  entityType,
  entityId,
  following: initial,
}: {
  entityType: FollowableType;
  entityId: string;
  following: boolean;
}) {
  const [following, setState] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      aria-pressed={following}
      title={error ?? (following ? "You hear about changes to this record. Click to stop." : "Hear about changes to this record under the bell.")}
      onClick={() =>
        start(async () => {
          setError(null);
          const result = await setFollowing(entityType, entityId, !following);
          if (result.ok) setState(result.data.following);
          else setError(result.error);
        })
      }
    >
      {following ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {following ? "Following" : "Follow"}
    </Button>
  );
}
