"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Terminal } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { entityHref, humanize } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/pulse";

/**
 * The write log, as it happens.
 *
 * Every other panel on the dashboard answers a question about state. This one
 * shows motion — who is doing what, right now — which is the thing a summary
 * card can never convey and the reason people leave a dashboard open.
 *
 * Rendered as a terminal because the content genuinely is a log: fixed-width
 * columns of timestamp, actor, entity and change, where alignment does real
 * work in letting the eye scan down one column. This is not decoration over a
 * table; a table would wrap and destroy the alignment.
 *
 * Seeded from the server so it has content on first paint, then appended to by
 * realtime. Capped at MAX_ROWS: an unbounded list left open overnight is a
 * memory leak and nobody scrolls back that far anyway.
 */
const MAX_ROWS = 40;

interface StreamRow extends FeedItem {
  /** Rows that arrived over the socket get a brief highlight. */
  fresh?: boolean;
}

export function ActivityStream({
  initial,
  visibleTypes,
}: {
  initial: FeedItem[];
  /**
   * The audited entity types this reader may see.
   *
   * RLS on audit_history is the boundary that matters and the socket is
   * filtered by it, so this is a second check rather than the only one — but
   * the panel appends whatever the socket hands it, and a client that renders
   * only what it was told to expect cannot start leaking because a policy was
   * later loosened somewhere else.
   */
  visibleTypes: string[];
}) {
  const [rows, setRows] = useState<StreamRow[]>(initial);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Held in a ref so a new array identity from the server does not tear down
  // and rebuild the socket subscription on every render.
  const allowed = useRef(new Set(visibleTypes));
  allowed.current = new Set(visibleTypes);

  useEffect(() => {
    const db = supabaseBrowser();

    const channel = db
      .channel("audit-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_history" },
        (payload) => {
          if (pausedRef.current) return;

          const r = payload.new as Record<string, any>;
          if (!allowed.current.has(String(r.entityType))) return;
          const row: StreamRow = {
            id: String(r.id),
            at: String(r.changedAt),
            entityType: String(r.entityType),
            entityId: String(r.entityId),
            fieldName: String(r.fieldName),
            oldValue: r.oldValue ?? null,
            newValue: r.newValue ?? null,
            // The realtime payload is the raw row, with no joins — the actor's
            // name is not in it. Showing the id would be noise, so the row
            // reads "someone" until the next full page load resolves it.
            actor: null,
            fresh: true,
          };

          setRows((prev) => {
            if (prev.some((p) => p.id === row.id)) return prev;
            return [row, ...prev].slice(0, MAX_ROWS);
          });
        },
      )
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border bg-slate-950 text-slate-300 dark:bg-slate-950/80">
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-2.5">
        <Terminal className="h-3.5 w-3.5 text-cyan-400" aria-hidden />
        <span className="font-mono text-[11px] tracking-wider text-cyan-400">
          activity.log
        </span>
        <span className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setPaused((p) => !p)}
            className="font-mono text-[11px] tracking-wider text-slate-500 transition-colors hover:text-slate-300"
            // Reading a row while the list shifts under the cursor is the
            // oldest complaint about live logs.
            title={paused ? "Resume the stream" : "Hold the stream so it stops moving"}
          >
            {paused ? "[ RESUME ]" : "[ PAUSE ]"}
          </button>
          <span className="font-mono text-[11px] text-slate-600">{rows.length}</span>
        </span>
      </div>

      <div className="max-h-[22rem] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-6 font-mono text-xs text-slate-600">
            awaiting first write…
          </p>
        ) : (
          <ul className="divide-y divide-slate-900">
            {rows.map((row) => (
              <StreamLine key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StreamLine({ row }: { row: StreamRow }) {
  const time = new Date(row.at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const href = entityHref(row.entityType, row.entityId);

  return (
    <li
      className={cn(
        "px-4 py-2 font-mono text-[11px] leading-relaxed transition-colors",
        row.fresh ? "bg-cyan-500/5" : "hover:bg-slate-900/60",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-slate-600 tabular-nums" suppressHydrationWarning>
          {time}
        </span>
        <span className="text-cyan-400">{row.actor ?? "someone"}</span>
        <span className="text-slate-600">→</span>
        {href ? (
          <Link href={href} className="text-slate-200 underline-offset-2 hover:underline">
            {humanize(row.entityType)}
          </Link>
        ) : (
          <span className="text-slate-200">{humanize(row.entityType)}</span>
        )}
        <span className="text-amber-400/90">{row.fieldName}</span>
      </div>

      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 pl-1 text-slate-500">
        <Value text={row.oldValue} tone="old" />
        <span className="text-slate-700">⇢</span>
        <Value text={row.newValue} tone="new" />
      </div>
    </li>
  );
}

/**
 * One side of a change.
 *
 * Long values are cut rather than wrapped: a pasted description would
 * otherwise push every row below it off the screen, and the point of the line
 * is that a field changed, not what the full new text is.
 */
function Value({ text, tone }: { text: string | null; tone: "old" | "new" }) {
  if (text === null || text === "") {
    return <span className="italic text-slate-700">empty</span>;
  }

  const clipped = text.length > 42 ? `${text.slice(0, 42)}…` : text;

  return (
    <span
      className={cn(tone === "new" ? "text-emerald-400" : "text-slate-500 line-through decoration-slate-700")}
      title={text.length > 42 ? text : undefined}
    >
      {clipped}
    </span>
  );
}
