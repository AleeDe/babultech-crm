"use server";

import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";

/** Public staff identity for assignment pickers; never include employee rates. */
export async function getProjectPeople() {
  await requirePermission(PERMISSIONS.PROJECT_READ);
  const db = await supabaseServer();
  const { data, error } = await db
    .from("app_user")
    .select("id, fullName, jobTitle")
    .eq("status", "ACTIVE")
    .is("deletedAt", null)
    .order("fullName");

  if (error) throw new Error("Could not load project people.");
  // Explicit projection also prevents unexpected columns crossing to clients.
  return (data ?? []).map(({ id, fullName, jobTitle }) => ({ id, fullName, jobTitle }));
}
