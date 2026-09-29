import { NextResponse } from "next/server";
import { loadBell } from "@/server/notifications";

/**
 * The bell's count and latest few, as a plain GET.
 *
 * Not a server action: those run one at a time per page, so a bell refresh
 * fired on navigation could queue ahead of - or abort - the action a person
 * had just pressed, leaving its button spinning. A GET runs alongside.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await loadBell().catch(() => ({ unread: 0, items: [] }));
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
