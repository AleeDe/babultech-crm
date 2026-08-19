"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { createRecord, updateRecord, LIST_LIMIT } from "@/lib/db";
import { one } from "@/lib/decimal";
import { PERMISSIONS, authorize, requirePermission, requireUser } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "./partners";

/**
 * User administration.
 *
 * A user record is three things at once: a login, a profile, and a role. The
 * role is what the app actually enforces — `SecurityRole.permissions` and
 * `dataScope` are read on every request by src/lib/authz.ts — so changing
 * someone's role is the single act that changes what they can do.
 *
 * Two kinds of user exist:
 *   - **Employees** (Administrator, Resource, Manager, Finance…) — internal
 *     staff, optionally with cost and billing rates that drive project
 *     profitability and utilisation.
 *   - **Partners** — external people who must be tied to a Partner record via
 *     `partnerId`. That link is what a partner portal scopes everything
 *     through, so a partner user without it is refused.
 */

const PARTNER_ROLE = "Partner";
const BCRYPT_ROUNDS = 10;

const passwordRules = z
  .string()
  .min(10, "Use at least 10 characters.")
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), "Mix upper and lower case.")
  .refine((v) => /[0-9]/.test(v), "Include a number.");

const userSchema = z.object({
  fullName: z.string().min(1).max(150),
  email: z.string().email().max(255),
  // Where notifications are delivered, when that differs from the sign-in
  // address. Empty string from an untouched form means "no override".
  notificationEmail: z
    .string()
    .email("Enter a valid email, or leave it empty.")
    .max(255)
    .optional()
    .nullable()
    .or(z.literal("")),
  employeeNumber: z.string().max(30).optional().nullable(),
  jobTitle: z.string().max(150).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  roleId: z.string().uuid(),
  departmentId: z.string().uuid().optional().nullable(),
  managerUserId: z.string().uuid().optional().nullable(),
  partnerId: z.string().uuid().optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).default("ACTIVE"),
  costRate: z.coerce.number().min(0).optional().nullable(),
  defaultBillingRate: z.coerce.number().min(0).optional().nullable(),
});

const createSchema = userSchema.extend({ password: passwordRules });

/**
 * Cross-field rules that depend on the chosen role. Kept in one place so
 * create and update cannot drift apart.
 */
async function validateAgainstRole(
  data: z.infer<typeof userSchema>,
  selfId?: string,
): Promise<ActionResult<never> | null> {
  const db = await supabaseServer();

  const { data: role } = await db
    .from("security_role")
    .select("name")
    .eq("id", data.roleId)
    .maybeSingle();

  if (!role) return { ok: false, error: "That role no longer exists." };

  if (role.name === PARTNER_ROLE) {
    if (!data.partnerId) {
      return {
        ok: false,
        error: "A partner user has to be linked to a partner record — that link is what their access is scoped through.",
        fieldErrors: { partnerId: ["Choose the partner this login belongs to."] },
      };
    }
    let takenQuery = db
      .from("app_user")
      .select("fullName")
      .eq("partnerId", data.partnerId);

    if (selfId) takenQuery = takenQuery.neq("id", selfId);

    const { data: taken } = await takenQuery.limit(1).maybeSingle();
    if (taken) {
      return {
        ok: false,
        error: `${taken.fullName} already has the login for that partner. A partner gets one portal account.`,
        fieldErrors: { partnerId: ["Already taken."] },
      };
    }
  } else if (data.partnerId) {
    return {
      ok: false,
      error: "Only a user on the Partner role can be linked to a partner record.",
      fieldErrors: { partnerId: ["Clear this, or switch the role to Partner."] },
    };
  }

  return null;
}

export async function createUser(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.ADMIN);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { password, ...data } = parsed.data;

  const invalid = await validateAgainstRole(data);
  if (invalid) return invalid;

  try {
    const db = await supabaseServer();
    const email = data.email.toLowerCase();

    const { data: existing } = await db
      .from("app_user")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      return {
        ok: false,
        error: "Someone already uses that email address.",
        fieldErrors: { email: ["Already registered."] },
      };
    }

    // Sign-in needs BOTH halves of the identity, so both are written here.
    //
    // NextAuth checks the bcrypt hash on app_user, then signs the same
    // credentials in to Supabase Auth so the request carries a JWT and RLS
    // lets the user read anything (src/lib/auth.ts). A user created with only
    // the app_user row passes the first check and fails the second, so the
    // account exists, looks correct in the admin screens, and cannot log in.
    // That is exactly what happened to every user added through this form.
    //
    // The auth user is created FIRST and its id reused as the app_user id.
    // Everything downstream — ownerUserId, RLS's app_visible_owner_ids(),
    // audit trails — assumes auth.users.id === app_user.id, and generating
    // two different ids is the failure scripts/migrate-auth-users.mjs had to
    // repair by hand once already.
    const auth = supabaseAdmin();

    const { data: created, error: authError } = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // No inbox round-trip: an admin created this account.
      user_metadata: { fullName: data.fullName },
    });

    if (authError || !created?.user) {
      return {
        ok: false,
        error: `Could not create the sign-in account: ${authError?.message ?? "unknown error"}`,
        fieldErrors: /already/i.test(authError?.message ?? "")
          ? { email: ["Already registered."] }
          : undefined,
      };
    }

    try {
      const user = await createRecord<{ id: string }>("app_user", {
        ...data,
        id: created.user.id,
        email,
        notificationEmail: data.notificationEmail || null,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      });

      revalidatePath("/users");
      return { ok: true, data: { id: user.id } };
    } catch (profileError) {
      // The profile insert failed after the auth user was created. Leaving it
      // behind would block the email forever with an account nobody can see or
      // administer, so it is removed before the error is reported.
      await auth.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw profileError;
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the user." };
  }
}

export async function updateUser(
  id: string,
  input: z.infer<typeof userSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.ADMIN);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const actor = _auth.user;

  const parsed = userSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const invalid = await validateAgainstRole(data, id);
  if (invalid) return invalid;

  try {
    const email = data.email.toLowerCase();
    const db = await supabaseServer();

    const { data: clash } = await db
      .from("app_user")
      .select("id")
      .eq("email", email)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (clash) {
      return {
        ok: false,
        error: "Someone already uses that email address.",
        fieldErrors: { email: ["Already registered."] },
      };
    }

    const { data: before } = await db
      .from("app_user")
      .select("roleId, status")
      .eq("id", id)
      .maybeSingle();

    if (!before) return { ok: false, error: "User not found." };

    // Locking yourself out, or demoting the last administrator, are both easy
    // accidents with no way back through the UI.
    if (id === actor.id && data.status !== "ACTIVE") {
      return { ok: false, error: "You cannot deactivate your own account." };
    }

    if (before.roleId !== data.roleId || before.status !== data.status) {
      const { data: adminRole } = await db
        .from("security_role")
        .select("id")
        .contains("permissions", ["*"])
        .limit(1)
        .maybeSingle();

      if (adminRole && before.roleId === adminRole.id) {
        const { count: remaining } = await db
          .from("app_user")
          .select("id", { count: "exact", head: true })
          .eq("roleId", adminRole.id)
          .eq("status", "ACTIVE")
          .is("deletedAt", null)
          .neq("id", id);

        const stillAdmin = data.roleId === adminRole.id && data.status === "ACTIVE";
        if ((remaining ?? 0) === 0 && !stillAdmin) {
          return {
            ok: false,
            error:
              "This is the last active administrator. Promote someone else before changing this account.",
          };
        }
      }
    }

    // A manager cannot report to themselves, directly or in a short cycle.
    if (data.managerUserId === id) {
      return { ok: false, error: "Someone cannot be their own manager." };
    }

    // Sign-in looks the account up by email in BOTH stores, so a change here
    // has to reach Supabase Auth as well or the user is locked out under their
    // new address while the old one no longer matches a profile.
    const { data: current } = await db
      .from("app_user")
      .select("email")
      .eq("id", id)
      .maybeSingle();

    if (current && current.email !== email) {
      const { error: authError } = await supabaseAdmin().auth.admin.updateUserById(id, {
        email,
        email_confirm: true,
      });

      if (authError) {
        return { ok: false, error: `Could not update the sign-in address: ${authError.message}` };
      }
    }

    // An empty field means "no override", which is null rather than "" — an
    // empty string would read as a real address and send mail nowhere.
    await updateRecord(
      "app_user",
      id,
      { ...data, email, notificationEmail: data.notificationEmail || null },
      "User",
      actor.id,
    );

    revalidatePath("/users");
    revalidatePath(`/users/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the user." };
  }
}

/** Administrator resets someone's password. */
export async function setUserPassword(id: string, password: string): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.ADMIN);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const actor = _auth.user;

  const parsed = passwordRules.safeParse(password);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That password is too weak.",
      fieldErrors: { password: parsed.error.issues.map((i) => i.message) },
    };
  }

  try {
    const db = await supabaseServer();

    const { data: user } = await db
      .from("app_user")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!user) return { ok: false, error: "User not found." };

    // Both stores hold the password, so both are updated. Changing only the
    // bcrypt hash leaves NextAuth accepting the new password and Supabase Auth
    // still expecting the old one, and sign-in fails at the second step — the
    // reset appears to work and locks the user out instead.
    const { error: authError } = await supabaseAdmin().auth.admin.updateUserById(
      user.id,
      { password: parsed.data },
    );

    if (authError) {
      return { ok: false, error: `Could not update the sign-in password: ${authError.message}` };
    }

    const { error } = await db
      .from("app_user")
      .update({
        passwordHash: await bcrypt.hash(parsed.data, BCRYPT_ROUNDS),
        updatedAt: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (error) throw new Error(error.message);

    // The hash itself is never recorded — only that a reset happened.
    await writeAudit({
      entityType: "User",
      entityId: id,
      fieldName: "passwordHash",
      oldValue: null,
      newValue: "reset",
      changedById: actor.id,
    });

    revalidatePath(`/users/${id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not set the password." };
  }
}

/** Lets the signed-in user change their own password. */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<ActionResult> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const actor = _auth.user;

  const parsed = passwordRules.safeParse(newPassword);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That password is too weak.",
      fieldErrors: { newPassword: parsed.error.issues.map((i) => i.message) },
    };
  }

  try {
    const db = await supabaseServer();

    const { data: user } = await db
      .from("app_user")
      .select("passwordHash")
      .eq("id", actor.id)
      .maybeSingle();

    if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return {
        ok: false,
        error: "That is not your current password.",
        fieldErrors: { currentPassword: ["Incorrect."] },
      };
    }

    // Supabase Auth first, for the same reason as the admin reset above: if
    // only the bcrypt hash moves, the next sign-in passes the NextAuth check
    // and is then rejected by Supabase, locking the user out of their own
    // account with a password they just set themselves.
    const { error: authError } = await supabaseAdmin().auth.admin.updateUserById(
      actor.id,
      { password: parsed.data },
    );

    if (authError) {
      return { ok: false, error: `Could not update your sign-in password: ${authError.message}` };
    }

    const { error } = await db
      .from("app_user")
      .update({
        passwordHash: await bcrypt.hash(parsed.data, BCRYPT_ROUNDS),
        updatedAt: new Date().toISOString(),
      })
      .eq("id", actor.id);

    if (error) throw new Error(error.message);

    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not change your password." };
  }
}

export async function listUsers(filters?: { search?: string; roleId?: string; status?: string }) {
  await requirePermission(PERMISSIONS.ADMIN);

  const db = await supabaseServer();

  let query = db
    .from("app_user")
    .select(
      `*,
       role:security_role ( id, name, dataScope, permissions ),
       department:app_user_departmentId_fkey ( id, name ),
       manager:managerUserId ( id, fullName ),
       partner:app_user_partnerId_fkey ( id, partnerNumber, displayName ),
       projectMemberships:project_member ( count ),
       ownedAccounts:account!account_ownerUserId_fkey ( count ),
       assignedTasks:project_task!project_task_assignedUserId_fkey ( count )`,
    )
    .is("deletedAt", null)
    .order("status")
    .order("fullName");

  if (filters?.roleId) query = query.eq("roleId", filters.roleId);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.search) {
    const s = filters.search.replace(/[,()]/g, "");
    query = query.or(
      `fullName.ilike.%${s}%,email.ilike.%${s}%,employeeNumber.ilike.%${s}%`,
    );
  }

  const { data, error } = await query.limit(LIST_LIMIT);
  if (error) throw new Error(`Could not load users: ${error.message}`);

  const countOf = (v: unknown) => (v as { count: number }[] | undefined)?.[0]?.count ?? 0;

  return (data ?? []).map((u) => ({
    ...u,
    role: one(u.role as never),
    department: one(u.department as never),
    manager: one(u.manager as never),
    partner: one(u.partner as never),
    _count: {
      projectMemberships: countOf(u.projectMemberships),
      ownedAccounts: countOf(u.ownedAccounts),
      assignedTasks: countOf(u.assignedTasks),
    },
  }));
}

export async function getUser(id: string) {
  await requirePermission(PERMISSIONS.ADMIN);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("app_user")
    .select(
      `*,
       role:security_role ( * ),
       department:app_user_departmentId_fkey ( id, name ),
       manager:managerUserId ( id, fullName ),
       partner:app_user_partnerId_fkey ( id, partnerNumber, displayName ),
       teamMemberships:team_member ( *, team ( id, name ) ),
       projectMemberships:project_member (
         *,
         project ( id, name, projectNumber, status )
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load user: ${error.message}`);
  if (!data) return null;

  // PostgREST cannot embed the reverse side of a self-referencing FK
  // (app_user.managerUserId -> app_user.id), so direct reports are a second query.
  const { data: reports } = await db
    .from("app_user")
    .select("id, fullName, jobTitle, status")
    .eq("managerUserId", id)
    .is("deletedAt", null);

  return {
    ...data,
    role: one(data.role as never),
    department: one(data.department as never),
    manager: one(data.manager as never),
    partner: one(data.partner as never),
    reports: reports ?? [],
    teamMemberships: ((data.teamMemberships ?? []) as Record<string, unknown>[]).map(
      (m) => ({ ...m, team: one(m.team as never) }),
    ),
    // Prisma filtered the memberships in the query; PostgREST returns them all.
    projectMemberships: ((data.projectMemberships ?? []) as Record<string, unknown>[])
      .filter((m) => m.active)
      .map((m) => ({ ...m, project: one(m.project as never) })),
  };
}

export async function getUserFormOptions() {
  await requirePermission(PERMISSIONS.ADMIN);

  const db = await supabaseServer();

  const [rolesRes, departmentsRes, managersRes, partnersRes, takenRes] =
    await Promise.all([
      db
        .from("security_role")
        .select("id, name, description, dataScope, permissions")
        .eq("active", true)
        .order("name"),
      db
        .from("department")
        .select("id, name")
        .is("deletedAt", null)
        .eq("active", true)
        .order("name"),
      db
        .from("app_user")
        .select("id, fullName, jobTitle")
        .eq("status", "ACTIVE")
        .is("deletedAt", null)
        .order("fullName"),
      db
        .from("partner")
        .select("id, partnerNumber, displayName, kind")
        .is("deletedAt", null)
        .order("displayName"),
      // Prisma expressed "no portal login yet" as `portalUser: null`. PostgREST
      // has no not-exists filter on an embedded relation, so the partner ids
      // that already have a login are fetched and excluded below.
      db.from("app_user").select("partnerId").not("partnerId", "is", null),
    ]);

  const taken = new Set((takenRes.data ?? []).map((u) => u.partnerId));

  return {
    roles: rolesRes.data ?? [],
    departments: departmentsRes.data ?? [],
    managers: managersRes.data ?? [],
    // One portal account per partner.
    partners: (partnersRes.data ?? []).filter((p) => !taken.has(p.id)),
  };
}

/** All partners, including those already holding a login — for the edit form. */
export async function getAllPartners() {
  await requirePermission(PERMISSIONS.ADMIN);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("partner")
    .select("id, partnerNumber, displayName, kind")
    .is("deletedAt", null)
    .order("displayName");

  if (error) throw new Error(`Could not load partners: ${error.message}`);
  return data ?? [];
}

/**
 * The caller's own place in the reporting line, for the user guide.
 *
 * Needs no permission beyond a session: it describes only the reader's own
 * position, and the names it returns are people whose records they can already
 * see under DEPARTMENT scope.
 *
 * `reportsBelow` walks the whole sub-tree, not just direct reports, because
 * that is what DEPARTMENT scope actually grants — telling someone they see
 * "3 reports" when the walk reaches 8 people would be misleading.
 */
export async function getMyReportingLine() {
  const me = await requireUser();
  const db = supabaseAdmin();

  const { data: staff } = await db
    .from("app_user")
    .select("id, fullName, managerUserId")
    .is("deletedAt", null);

  const everyone = staff ?? [];
  const manager = everyone.find(
    (u) => u.id === everyone.find((x) => x.id === me.id)?.managerUserId,
  );

  const directReports = everyone.filter((u) => u.managerUserId === me.id);

  // Same cycle-safe walk as scopeFilter, so the count cannot disagree with it.
  const below = new Set<string>();
  const queue = [me.id];
  const seen = new Set<string>([me.id]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of everyone.filter((u) => u.managerUserId === current)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      below.add(child.id);
      queue.push(child.id);
    }
  }

  return {
    managerName: manager?.fullName ?? null,
    directReports: directReports.map((r) => r.fullName),
    totalBelow: below.size,
  };
}
