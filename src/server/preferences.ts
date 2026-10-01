"use server";

import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { authorize, requireUser } from "@/lib/authz";
import { getCompanyTimeZone } from "@/lib/currency-loader";
import { validTimeZone } from "@/lib/date-prefs";
import { START_PAGES } from "@/lib/start-pages";
import type { ActionResult } from "./partners";

/** Each person's own preferences (user_preference): time zone, date format, start page. */

export interface Preferences {
  timeZone: string | null;
  dateFormat: "DMY" | "MDY" | "YMD";
  startPage: string | null;
  companyTimeZone: string | null;
}

export async function getPreferences(): Promise<Preferences> {
  const me = await requireUser();
  return {
    timeZone: me.preferences?.timeZone ?? null,
    dateFormat: me.preferences?.dateFormat ?? "DMY",
    startPage: me.preferences?.startPage ?? null,
    companyTimeZone: getCompanyTimeZone(),
  };
}

const schema = z.object({
  timeZone: z.string().max(64).nullable(),
  dateFormat: z.enum(["DMY", "MDY", "YMD"]),
  startPage: z.string().max(100).nullable(),
});

export async function savePreferences(input: z.infer<typeof schema>): Promise<ActionResult<null>> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check your preferences." };
  const d = parsed.data;
  if (d.timeZone && !validTimeZone(d.timeZone)) return { ok: false, error: "That time zone is not one we know." };
  const pages = START_PAGES[auth.user.userType] ?? [];
  if (d.startPage && !pages.some((p) => p.href === d.startPage)) return { ok: false, error: "Choose a start page from the list." };

  const db = await supabaseServer();
  const { error } = await db.from("user_preference").upsert(
    { userId: auth.user.id, timeZone: d.timeZone || null, dateFormat: d.dateFormat, startPage: d.startPage || null, updatedAt: new Date().toISOString() },
    { onConflict: "userId" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
