"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Activity, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";

/** Tables whose changes make anything on the dashboard wrong. */
const WATCHED = [
  "opportunity",
  "invoice",
  "payment",
  "support_case",
  "lead",
  "quotation",
  "project",
  "commission_record",
] as const;

type Status = "connecting" | "live" | "offline";

/**
 * Connection light plus a coalesced refresh.
 *
 * A dashboard that silently goes stale is worse than one that never claimed to
 * be live, so the state of the socket is shown rather than assumed. Three
 * states, because "connecting" and "gave up" call for different reactions from
 * the reader.
 *
 * Changes are batched: a save that touches an invoice and three lines produces
 * several notifications within a few milliseconds, and each one triggering its
 * own `router.refresh()` would re-render the page four times to show one edit.
 * The window is short enough to still feel immediate.
 *
 * `refresh()` re-runs the server components and diffs the result, so the page
 * updates in place — no scroll jump, no flash, no client-side copy of the data
 * that could disagree with the server's.
 */
export function LiveIndicator({ className }: { className?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("connecting");
  const [pending, startTransition] = useTransition();
  const [lastChange, setLastChange] = useState<Date | null>(null);
  const [changeCount, setChangeCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const db = supabaseBrowser();
    const channel = db.channel("dashboard-pulse");

    for (const table of WATCHED) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        setLastChange(new Date());
        setChangeCount((n) => n + 1);

        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          startTransition(() => router.refresh());
        }, 600);
      });
    }

    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") setStatus("live");
      else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        setStatus("offline");
      }
    });

    return () => {
      if (timer.current) clearTimeout(timer.current);
      db.removeChannel(channel);
    };
  }, [router]);

  const dot =
    status === "live"
      ? "bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]"
      : status === "connecting"
        ? "bg-amber-400"
        : "bg-red-500";

  const label =
    status === "live"
      ? changeCount > 0
        ? `LIVE · ${changeCount} change${changeCount === 1 ? "" : "s"}`
        : "LIVE"
      : status === "connecting"
        ? "CONNECTING"
        : "OFFLINE";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] tracking-wider",
        status === "live"
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
          : status === "connecting"
            ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
            : "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
        className,
      )}
      title={
        status === "live"
          ? lastChange
            ? `Last change ${lastChange.toLocaleTimeString()}`
            : "Watching for changes"
          : status === "offline"
            ? "Realtime disconnected - the figures below may be out of date. Reload to catch up."
            : "Opening the realtime connection"
      }
      role="status"
      aria-live="polite"
    >
      {pending ? (
        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
      ) : (
        <span className={cn("h-2 w-2 rounded-full", dot, status === "live" && "animate-pulse")} aria-hidden />
      )}
      <span>{label}</span>
    </div>
  );
}

/**
 * A clock that ticks.
 *
 * Rendered on the client only after mount: the server's second and the
 * browser's never match, and React would log a hydration mismatch for a
 * difference that is genuinely expected.
 */
export function LiveClock({ className }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className={cn("font-mono text-[11px] tabular-nums text-muted-foreground", className)}
      suppressHydrationWarning
    >
      {now
        ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
        : "--:--:--"}
    </span>
  );
}

/** Small live-pulse mark for section headers. */
export function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)} aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

export { Activity };
