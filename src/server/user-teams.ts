"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { z } from "zod";

export async function getUserTeams(userId: string) {
  await requirePermission(PERMISSIONS.ADMIN);
  const id = z.string().uuid().parse(userId);
  const db = await supabaseServer();
  const [user, teams, memberships] = await Promise.all([
    db.from("app_user").select("id, fullName, status, partnerId").eq("id", id).is("deletedAt", null).single(),
    db.from("team").select("id, name, teamType, active").is("deletedAt", null).order("name"),
    db.from("team_member").select("id, teamId").eq("userId", id),
  ]);
  for (const result of [user, teams, memberships]) if (result.error) throw new Error(result.error.message);
  return { user: user.data!, teams: teams.data ?? [], memberships: memberships.data ?? [] };
}

export async function changeUserTeam(input: { userId: string; teamId: string; operation: "add" | "remove" }) {
  await requirePermission(PERMISSIONS.ADMIN);
  const parsed = z.object({ userId: z.string().uuid(), teamId: z.string().uuid(), operation: z.enum(["add", "remove"]) }).safeParse(input);
  if (!parsed.success) return { error: "Choose a valid user and team." };
  const { userId, teamId, operation } = parsed.data;
  const db = await supabaseServer();
  if (operation === "remove") {
    const { error } = await db.from("team_member").delete().eq("userId", userId).eq("teamId", teamId);
    if (error) return { error: error.message };
  } else {
    const [user, team, existing] = await Promise.all([
      db.from("app_user").select("id").eq("id", userId).eq("status", "ACTIVE").is("partnerId", null).is("deletedAt", null).maybeSingle(),
      db.from("team").select("id").eq("id", teamId).eq("active", true).is("deletedAt", null).maybeSingle(),
      db.from("team_member").select("id").eq("userId", userId).eq("teamId", teamId).limit(1),
    ]);
    if (user.error || team.error || existing.error || !user.data || !team.data) return { error: "Only active internal users can join active teams." };
    if (!existing.data?.length) {
      // Stable ID makes concurrent submissions and retries insert at most once.
      const hash = createHash("sha256").update(`membership:${userId}:${teamId}`).digest("hex");
      const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
      const { error } = await db.from("team_member").upsert({ id, userId, teamId, updatedAt: new Date().toISOString() }, { onConflict: "id", ignoreDuplicates: true });
      if (error) return { error: error.message };
    }
  }
  revalidatePath(`/users/${userId}`);
  revalidatePath(`/users/${userId}/teams`);
  return { error: null };
}

export async function createUserTeam(input: { name: string; teamType: string }) {
  await requirePermission(PERMISSIONS.ADMIN);
  const parsed = z.object({ name: z.string().trim().min(2).max(100), teamType: z.enum(["SALES", "SUPPORT", "PROJECT", "FINANCE", "MARKETING"]) }).safeParse(input);
  if (!parsed.success) return { error: "Enter a team name and a valid team type." };
  const db = await supabaseServer();
  const { data: existing, error: lookupError } = await db.from("team").select("id").ilike("name", parsed.data.name.replace(/[%_]/g, "\\$&")).is("deletedAt", null).limit(1);
  if (lookupError) return { error: lookupError.message };
  if (existing?.length) return { error: "A team with this name already exists. Choose it from the list." };
  const { error } = await db.from("team").insert({ id: crypto.randomUUID(), ...parsed.data, active: true, updatedAt: new Date().toISOString() });
  return { error: error?.message ?? null };
}
