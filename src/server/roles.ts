"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { authorize, PERMISSIONS } from "@/lib/authz";
import { ALL_PERMISSIONS, DATA_SCOPES } from "@/lib/permission-catalogue";
import type { ActionResult } from "./partners";

/**
 * Roles, and what each one may do.
 *
 * Changing a role changes what everybody holding it can do, at once and without
 * them signing in again - requireUser() reads the role on every request. That
 * is the point, and it is also why this is administrator-only and why the
 * guards below exist:
 *
 *   * the system roles (Super Admin, Partner, Customer) cannot be renamed,
 *     re-scoped, re-permissioned or deleted. The application looks Super Admin
 *     up by its permissions and the other two by name, and the two portals
 *     depend on their holders having no CRM permissions at all;
 *   * a role with people in it cannot be deleted, because their access would
 *     vanish with it; and
 *   * nothing here can grant a permission the catalogue does not list, so a
 *     typo cannot create a permission that looks granted and is checked
 *     nowhere.
 *
 * Read with the service-role client throughout: security_role deliberately has
 * no SELECT policy, so a normal client cannot see it at all.
 */

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  dataScope: string;
  permissions: string[];
  isSystem: boolean;
  active: boolean;
  /** How many live people hold it, which decides whether it can be deleted. */
  userCount: number;
}

export async function listRoles(): Promise<RoleRow[]> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return [];

  const admin = supabaseAdmin();
  const [roles, users] = await Promise.all([
    admin.from("security_role").select("*").order("name"),
    admin.from("app_user").select("roleId").is("deletedAt", null),
  ]);

  const counts = new Map<string, number>();
  for (const user of users.data ?? []) {
    const id = user.roleId as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (roles.data ?? []).map((role) => ({
    id: role.id as string,
    name: role.name as string,
    description: (role.description as string | null) ?? null,
    dataScope: role.dataScope as string,
    permissions: (role.permissions as string[] | null) ?? [],
    isSystem: Boolean(role.isSystem),
    active: Boolean(role.active),
    userCount: counts.get(role.id as string) ?? 0,
  }));
}

const roleSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1, "Give the role a name.").max(100, "That name is too long."),
  description: z.string().trim().max(1000).optional().nullable(),
  dataScope: z.enum(DATA_SCOPES.map((s) => s.value) as [string, ...string[]]),
  permissions: z.array(z.string()).max(200),
});

export async function saveRole(input: z.infer<typeof roleSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Only permissions the catalogue knows about. Anything else would read as
  // granted on this screen and be checked by nothing.
  const unknown = data.permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (unknown.length) {
    return { ok: false, error: `Unknown permission: ${unknown[0]}.` };
  }

  const admin = supabaseAdmin();

  if (data.id) {
    const { data: before } = await admin
      .from("security_role")
      .select("id, name, isSystem")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) return { ok: false, error: "That role no longer exists." };
    if (before.isSystem) {
      return {
        ok: false,
        error: `${before.name} is a built-in role. Its permissions are fixed because the application depends on them. Create a new role instead.`,
      };
    }
  }

  const { data: clash } = await admin
    .from("security_role")
    .select("id")
    .ilike("name", data.name)
    .maybeSingle();
  if (clash && clash.id !== data.id) {
    return { ok: false, error: `A role called "${data.name}" already exists.`, fieldErrors: { name: ["Already in use."] } };
  }

  const row = {
    name: data.name,
    description: data.description || null,
    dataScope: data.dataScope,
    permissions: data.permissions,
    updatedAt: new Date().toISOString(),
  };

  const { data: saved, error } = data.id
    ? await admin.from("security_role").update(row).eq("id", data.id).select("id").maybeSingle()
    : await admin
        .from("security_role")
        .insert({ id: randomUUID(), isSystem: false, active: true, ...row })
        .select("id")
        .single();

  if (error) return { ok: false, error: error.message };
  if (!saved) return { ok: false, error: "That role no longer exists." };

  // Every screen reads permissions through the session, so all of them are stale.
  revalidatePath("/", "layout");
  return { ok: true, data: { id: saved.id as string } };
}

export async function deleteRole(id: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = supabaseAdmin();
  const { data: role } = await admin
    .from("security_role")
    .select("id, name, isSystem")
    .eq("id", id)
    .maybeSingle();
  if (!role) return { ok: false, error: "That role no longer exists." };
  if (role.isSystem) return { ok: false, error: `${role.name} is a built-in role and cannot be deleted.` };

  const { count } = await admin
    .from("app_user")
    .select("id", { count: "exact", head: true })
    .eq("roleId", id)
    .is("deletedAt", null);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} ${count === 1 ? "person holds" : "people hold"} this role. Move them to another role first.`,
    };
  }

  const { error } = await admin.from("security_role").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
