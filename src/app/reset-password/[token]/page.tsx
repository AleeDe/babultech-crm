import type { Metadata } from "next";
import Link from "next/link";
import { getPasswordLinkContext } from "@/server/password-links";
import { Card } from "@/components/ui";
import { ResetForm } from "./reset-form";

// A password link must never reach a search index.
export const metadata: Metadata = { title: "Choose your password", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where a welcome or reset link lands, without a login. The token is the only
 * key; an unknown, used or expired one shows the same page, which says nothing
 * about whether it ever existed.
 */
export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getPasswordLinkContext(token);

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm p-7 shadow-lg">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-md shadow-primary/20">
            BT
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            {!context ? "This link is not valid" : context.purpose === "WELCOME" ? `Welcome, ${context.fullName.split(" ")[0]}` : "Set a new password"}
          </h1>
        </div>
        {context ? (
          <ResetForm token={token} email={context.email} />
        ) : (
          <div className="space-y-4 text-center text-sm text-muted-foreground">
            <p>It may have expired, been used already, or been replaced by a newer link. Ask your administrator to send you a new one.</p>
            <Link href="/login" className="font-medium text-primary hover:underline">Go to sign in</Link>
          </div>
        )}
      </Card>
    </div>
  );
}
