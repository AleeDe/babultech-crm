"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Copy, Check, ShieldAlert } from "lucide-react";
import { revealSecret } from "@/server/secrets";
import { Button, Alert } from "@/components/ui";

/** How long a revealed value stays on screen before it hides itself again. */
const HIDE_AFTER_SECONDS = 45;

/**
 * Reveal a stored credential.
 *
 * The value is fetched only when asked for, never as part of rendering the
 * page, and it is held in component state alone — nothing writes it to
 * localStorage or the URL, so it disappears with the tab.
 *
 * It also hides itself on a timer. A credential left on a screen is the
 * everyday way these leak: someone reveals a key, gets pulled into a meeting,
 * and it sits there on a shared monitor.
 */
export function RevealSecret({ secretId }: { secretId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(HIDE_AFTER_SECONDS);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Count down while a value is on screen, and clear it at zero.
  useEffect(() => {
    if (value === null) return;

    setSecondsLeft(HIDE_AFTER_SECONDS);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setValue(null);
          return HIDE_AFTER_SECONDS;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [value]);

  function onReveal() {
    setError(null);
    startTransition(async () => {
      const result = await revealSecret(secretId);
      if (result.ok) {
        setValue(result.data.value);
        // The access log on this page is now one row out of date.
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  async function onCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not reach the clipboard. Select the value and copy it by hand.");
    }
  }

  function onHide() {
    setValue(null);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  if (error && value === null) {
    return (
      <div className="space-y-3">
        <Alert tone="danger">{error}</Alert>
        <Button variant="outline" onClick={onReveal} disabled={pending}>
          Try again
        </Button>
      </div>
    );
  }

  if (value === null) {
    return (
      <div className="space-y-3">
        <Button variant="outline" onClick={onReveal} disabled={pending}>
          <Eye className="h-4 w-4" />
          {pending ? "Revealing…" : "Reveal the value"}
        </Button>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Your name and the time are recorded against this secret whenever you
          reveal it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded border bg-muted px-3 py-2 font-mono text-sm">
          {value}
        </code>
        <Button variant="outline" onClick={onCopy} aria-label="Copy the value">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
        <Button variant="outline" onClick={onHide}>
          Hide
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="text-xs text-muted-foreground">
        Hiding itself in {secondsLeft} second{secondsLeft === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
