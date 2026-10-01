import { NextResponse } from "next/server";
import { listRecent } from "@/server/recent";
import { listFavorites } from "@/server/favorites";

/** Favourites and recently opened records, for the search box. A GET, so it also works during View as. */
export const dynamic = "force-dynamic";

export async function GET() {
  const [items, favorites] = await Promise.all([listRecent(12).catch(() => []), listFavorites(20).catch(() => [])]);
  return NextResponse.json({ items, favorites }, { headers: { "Cache-Control": "no-store" } });
}
