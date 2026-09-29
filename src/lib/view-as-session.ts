import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase";
import { VIEW_AS_COOKIE } from "./view-as";

/**
 * Ends the View as session this browser has open, if any: records the end,
 * revokes the sign-in issued for it and clears the cookie. Safe to call when
 * there is none.
 */
export async function endViewAs(detail: string): Promise<{ targetUserId: string } | null> {
  const store = await cookies();
  const raw = store.get(VIEW_AS_COOKIE)?.value;
  if (!raw) return null;
  store.delete(VIEW_AS_COOKIE);

  let parsed: { id?: string; token?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed.id) return null;

  const db = supabaseAdmin();
  const { data: row } = await db
    .from("view_as_session")
    .update({ endedAt: new Date().toISOString() })
    .eq("id", parsed.id)
    .is("endedAt", null)
    .select("adminUserId, targetUserId")
    .maybeSingle();

  // The issued sign-in is revoked, so its refresh token is useless; its
  // access token stays refused by the database until it expires.
  if (parsed.token) await db.auth.admin.signOut(parsed.token, "local").catch(() => {});

  if (row) {
    const { recordLoginEvent } = await import("./auth");
    await recordLoginEvent({
      eventType: "VIEW_AS_END",
      userId: row.adminUserId as string,
      targetUserId: row.targetUserId as string,
      detail,
    });
    return { targetUserId: row.targetUserId as string };
  }
  return null;
}
