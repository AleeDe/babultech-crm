import type { Metadata } from "next";
import { humanize } from "@/lib/utils";
import { canDecide } from "@/lib/client-review";
import { getClientReviewContext } from "@/server/client-review";
import { DecisionForm } from "./decision-form";

// A review link must never reach a search index.
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ClientReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getClientReviewContext(token);

  // An unknown, malformed or deleted link all look the same from out here. It
  // says nothing about whether the link ever existed.
  if (!context) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">This review link is not valid</h1>
        <p className="mt-3 text-muted-foreground">
          It may have been mistyped, or withdrawn. Please contact the person who sent it to you.
        </p>
      </Shell>
    );
  }

  const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Asia/Karachi" });
  const times = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Karachi" });

  return (
    <Shell>
      <header className="border-b pb-5">
        <p className="text-sm text-muted-foreground">For review by {context.recipientName}</p>
        <h1 className="mt-1 text-2xl font-semibold">{context.taskName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {humanize(context.channel)} · {humanize(context.format)} · Version {context.versionNumber}
          {context.plannedFor && ` · Planned for ${dates.format(new Date(context.plannedFor))}`}
        </p>
      </header>

      {context.revoked && (
        <Notice tone="warning">
          This review link has been withdrawn. Please contact your account manager.
        </Notice>
      )}
      {!context.revoked && context.expired && !context.decision && (
        <Notice tone="warning">
          This review link expired on {dates.format(new Date(context.expiresAt))}. Please ask for a new one.
        </Notice>
      )}

      {context.decision && (
        <Notice tone={context.decision.decision === "APPROVED" ? "success" : "info"}>
          <p className="font-medium">
            {context.decision.decision === "APPROVED"
              ? "You approved this."
              : "You asked for changes to this."}
          </p>
          <p className="mt-1 text-sm">
            Recorded {times.format(new Date(context.decision.at))}
            {context.decision.approver ? ` by ${context.decision.approver}` : ""}.
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{context.decision.evidence}</p>
        </Notice>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">What this is for</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Objective</dt>
            <dd className="whitespace-pre-wrap">{context.objective}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Audience</dt>
            <dd className="whitespace-pre-wrap">{context.audience}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted-foreground">Brief</dt>
            <dd className="whitespace-pre-wrap">{context.brief}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">The copy</h2>
        <div className="mt-3 whitespace-pre-wrap rounded-xl border bg-white p-5 leading-relaxed">
          {context.copy}
        </div>
        {context.assetUrl && (
          <p className="mt-3 text-sm">
            Attached file:{" "}
            <a
              className="underline"
              href={context.assetUrl}
              target="_blank"
              rel="noreferrer noopener nofollow"
            >
              {context.assetUrl}
            </a>
          </p>
        )}
      </section>

      {canDecide(context) && (
        <section className="mt-8 border-t pt-6">
          <h2 className="text-lg font-semibold">Your decision</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is recorded against this exact version. If you ask for changes, the team will send a
            new version for review.
          </p>
          <DecisionForm token={token} />
        </section>
      )}

      <footer className="mt-10 border-t pt-5 text-xs text-muted-foreground">
        This page shows one item for review. It does not require an account, and it stops working on{" "}
        {dates.format(new Date(context.expiresAt))}. Please do not forward it.
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-10 sm:px-6">
      {children}
    </main>
  );
}

function Notice({ tone, children }: { tone: "success" | "warning" | "info"; children: React.ReactNode }) {
  const tones = {
    success: "border-green-300 bg-green-50 text-green-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    info: "border-blue-300 bg-blue-50 text-blue-900",
  };
  return <div className={`mt-6 rounded-xl border p-4 ${tones[tone]}`}>{children}</div>;
}
