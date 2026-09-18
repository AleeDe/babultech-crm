"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Select } from "@/components/ui";
import { DEFAULT_EXPIRY_DAYS, reviewLinkUrl } from "@/lib/client-review";
import { issueReviewLink, revokeReviewLink } from "@/server/client-review";

type Link = {
  id: string;
  recipientName: string;
  recipientEmail: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

/**
 * Sending a version to the client, and what happened to the links already sent.
 *
 * The token appears exactly once, here, immediately after it is minted. It is
 * not stored and cannot be shown again: if it is lost, withdraw the link and
 * send another.
 */
export function ReviewLinkPanel({
  versionId,
  links,
  canSend,
}: {
  versionId: string;
  links: Link[];
  canSend: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
  const live = links.filter((l) => !l.revokedAt && !l.usedAt && new Date(l.expiresAt) > new Date());

  return (
    <div className="mt-4 rounded-lg border p-4">
      <h3 className="font-medium">Client review link</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Sends this exact version to the client so they can record their own decision, instead of
        someone here writing down what they said.
      </p>

      {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}

      {minted && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            Copy this link now — it cannot be shown again.
          </p>
          <p className="mt-2 break-all rounded bg-white p-2 font-mono text-xs">{minted.url}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(minted.url).then(
                  () => { setCopied(true); setTimeout(() => setCopied(false), 3000); },
                  () => setCopied(false),
                );
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <span className="text-xs text-amber-900">
              Expires {dates.format(new Date(minted.expiresAt))} PKT
            </span>
          </div>
        </div>
      )}

      {canSend && live.length === 0 && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setError(null);
            setMinted(null);
            start(async () => {
              const result = await issueReviewLink({
                versionId,
                recipientName: String(form.get("recipientName") ?? ""),
                recipientEmail: String(form.get("recipientEmail") ?? ""),
                expiryDays: Number(form.get("expiryDays") ?? DEFAULT_EXPIRY_DAYS),
              });
              if (result.ok) {
                setMinted({
                  url: reviewLinkUrl(window.location.origin, result.data.token),
                  expiresAt: result.data.expiresAt,
                });
                router.refresh();
              } else setError(result.error);
            });
          }}
        >
          <label className="text-sm">
            Client reviewer&apos;s name
            <Input name="recipientName" required maxLength={200} disabled={pending} />
          </label>
          <label className="text-sm">
            Their email
            <Input name="recipientEmail" type="email" required maxLength={320} disabled={pending} />
          </label>
          <label className="text-sm">
            Link expires after
            <Select name="expiryDays" defaultValue={String(DEFAULT_EXPIRY_DAYS)} disabled={pending}>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </Select>
          </label>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            The email is recorded for the audit trail. Nothing is sent from here — copy the link and
            send it yourself. Anyone holding the link can use it, so send it to the right person.
          </p>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create review link"}
          </Button>
        </form>
      )}

      {canSend && live.length > 0 && !minted && (
        <p className="mt-3 text-sm text-muted-foreground">
          A link is already out with this version. Withdraw it below before sending another.
        </p>
      )}

      {links.length > 0 && (
        <ul className="mt-4 space-y-2">
          {links.map((link) => {
            const expired = new Date(link.expiresAt) <= new Date();
            const state = link.revokedAt
              ? "Withdrawn"
              : link.usedAt
                ? `Used ${dates.format(new Date(link.usedAt))} PKT`
                : expired
                  ? "Expired"
                  : `Open until ${dates.format(new Date(link.expiresAt))} PKT`;
            return (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                <span>
                  {link.recipientName} · {link.recipientEmail}
                  <span className="block text-muted-foreground">{state}</span>
                </span>
                {canSend && !link.revokedAt && !link.usedAt && !expired && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      start(async () => {
                        const result = await revokeReviewLink(link.id);
                        if (result.ok) { setMinted(null); router.refresh(); }
                        else setError(result.error);
                      });
                    }}
                  >
                    Withdraw
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
