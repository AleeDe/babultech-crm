"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui";
import { setFavorite } from "@/server/favorites";

/** The star on a record's header: keep it in your favourites. */
export function FavoriteButton({ entityType, entityId, label, favorite: initial }: { entityType: string; entityId: string; label: string; favorite: boolean }) {
  const [favorite, setState] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      aria-pressed={favorite}
      aria-label={favorite ? "Remove from favourites" : "Add to favourites"}
      title={error ?? (favorite ? "In your favourites. Click to remove." : "Add to your favourites, in search and on My work.")}
      onClick={() =>
        start(async () => {
          setError(null);
          const result = await setFavorite(entityType, entityId, label, !favorite);
          if (result.ok) setState(result.data.favorite);
          else setError(result.error);
        })
      }
    >
      <Star className={`h-4 w-4 ${favorite ? "fill-amber-400 text-amber-500" : ""}`} />
      {favorite ? "Favourite" : "Add to favourites"}
    </Button>
  );
}
