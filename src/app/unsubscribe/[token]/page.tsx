import { createClient } from "@supabase/supabase-js";

/**
 * The unsubscribe link from a campaign email.
 *
 * Outside the (app) group on purpose: whoever clicks it has no account and no
 * session, and sending them to a login screen to stop receiving email is the
 * behaviour that gets a sender reported as spam.
 *
 * It uses the anonymous key and one function that takes a token and nothing
 * else. The function answers the same way whether or not the token exists, so
 * a stranger with a guessed token learns nothing.
 *
 * One click, no confirmation step. A confirmation page is a second thing to
 * get wrong between somebody deciding to leave and actually leaving, and mail
 * clients' one-click unsubscribe expects the request itself to be enough.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let done = false;
  if (/^[0-9a-f-]{36}$/i.test(token)) {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await db.rpc("unsubscribe_activity", { p_activity: token });
    done = !error;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
        {done ? (
          <>
            <h1 className="text-xl font-semibold">You have been unsubscribed</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              We will not send you any more marketing email. It can take a few minutes for anything
              already on its way to stop.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              If this was a mistake, reply to any email you have from us and we will put you back
              on the list.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">That link did not work</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              It may have been cut short by your email program. Reply to the email you received and
              we will remove you by hand.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
