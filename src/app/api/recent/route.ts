import { NextResponse } from "next/server";
import { listRecent } from "@/server/recent";

/** Recently opened records, for the search box. A GET, so it also works during View as. */
export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listRecent(12).catch(() => []);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
