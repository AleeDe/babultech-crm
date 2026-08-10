"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requirePermission, requireUser, PERMISSIONS } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
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
  const role = await prisma.securityRole.findUnique({
    where: { id: data.roleId },
    select: { name: true },
  });
  if (!role) return { ok: false, error: "That role no longer exists." };

  if (role.name === PARTNER_ROLE) {
    if (!data.partnerId) {
      return {
        ok: false,
        error: "A partner user has to be linked to a partner record — that link is what their access is scoped through.",
        fieldErrors: { partnerId: ["Choose the partner this login belongs to."] },
      };
    }
    const taken = await prisma.user.findFirst({
      where: { partnerId: data.partnerId, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { fullName: true },
    });
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
  await requirePermission(PERMISSIONS.ADMIN);

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { password, ...data } = parsed.data;

  const invalid = await validateAgainstRole(data);
  if (invalid) return invalid;

  try {
    const email = data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return {
        ok: false,
        error: "Someone already uses that email address.",
        fieldErrors: { email: ["Already registered."] },
      };
    }

    const user = await prisma.user.create({
      data: {
        ...data,
        email,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      },
    });

    revalidatePath("/users");
    return { ok: true, data: { id: user.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the user." };
  }
}

export async function updateUser(
  id: string,
  input: z.infer<typeof userSchema>,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requirePermission(PERMISSIONS.ADMIN);

  const parsed = userSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const invalid = await validateAgainstRole(data, id);
  if (invalid) return invalid;

  try {
    const email = data.email.toLowerCase();
    const clash = await prisma.user.findFirst({
      where: { email, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      return {
        ok: false,
        error: "Someone already uses that email address.",
        fieldErrors: { email: ["Already registered."] },
      };
    }

    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id } });

      // Locking yourself out, or demoting the last administrator, are both
      // easy accidents with no way back through the UI.
      if (id === actor.id && data.status !== "ACTIVE") {
        throw new Error("You cannot deactivate your own account.");
      }
      if (before.roleId !== data.roleId || before.status !== data.status) {
        const adminRole = await tx.securityRole.findFirst({
          where: { permissions: { has: "*" } },
          select: { id: true },
        });
        if (adminRole && before.roleId === adminRole.id) {
          const remaining = await tx.user.count({
            where: {
              roleId: adminRole.id,
              status: "ACTIVE",
              deletedAt: null,
              id: { not: id },
            },
          });
          const stillAdmin = data.roleId === adminRole.id && data.status === "ACTIVE";
          if (remaining === 0 && !stillAdmin) {
            throw new Error(
              "This is the last active administrator. Promote someone else before changing this account.",
            );
          }
        }
      }

      // A manager cannot report to themselves, directly or in a short cycle.
      if (data.managerUserId === id) {
        throw new Error("Someone cannot be their own manager.");
      }

      const after = await tx.user.update({
        where: { id },
        data: { ...data, email },
      });

      await auditChanges(tx, {
        entityType: "User",
        entityId: id,
        before,
        after,
        changedById: actor.id,
      });
    });

    revalidatePath("/users");
    revalidatePath(`/users/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the user." };
  }
}

/** Administrator resets someone's password. */
export async function setUserPassword(id: string, password: string): Promise<ActionResult> {
  const actor = await requirePermission(PERMISSIONS.ADMIN);

  const parsed = passwordRules.safeParse(password);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That password is too weak.",
      fieldErrors: { password: parsed.error.issues.map((i) => i.message) },
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id }, select: { id: true } });
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(parsed.data, BCRYPT_ROUNDS) },
      });
      await tx.auditHistory.create({
        data: {
          entityType: "User",
          entityId: id,
          fieldName: "passwordHash",
          oldValue: null,
          newValue: "reset",
          changedById: actor.id,
          source: "UI",
        },
      });
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
  const actor = await requireUser();

  const parsed = passwordRules.safeParse(newPassword);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That password is too weak.",
      fieldErrors: { newPassword: parsed.error.issues.map((i) => i.message) },
    };
  }

  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { passwordHash: true },
    });
    if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return {
        ok: false,
        error: "That is not your current password.",
        fieldErrors: { currentPassword: ["Incorrect."] },
      };
    }

    await prisma.user.update({
      where: { id: actor.id },
      data: { passwordHash: await bcrypt.hash(parsed.data, BCRYPT_ROUNDS) },
    });

    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not change your password." };
  }
}

export async function listUsers(filters?: { search?: string; roleId?: string; status?: string }) {
  await requirePermission(PERMISSIONS.ADMIN);

  return prisma.user.findMany({
    where: {
      deletedAt: null,
      ...(filters?.roleId ? { roleId: filters.roleId } : {}),
      ...(filters?.status ? { status: filters.status as never } : {}),
      ...(filters?.search
        ? {
            OR: [
              { fullName: { contains: filters.search, mode: "insensitive" as const } },
              { email: { contains: filters.search, mode: "insensitive" as const } },
              { employeeNumber: { contains: filters.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      role: { select: { id: true, name: true, dataScope: true, permissions: true } },
      department: { select: { id: true, name: true } },
      manager: { select: { id: true, fullName: true } },
      partner: { select: { id: true, partnerNumber: true, displayName: true } },
      _count: { select: { projectMemberships: true, ownedAccounts: true, assignedTasks: true } },
    },
    orderBy: [{ status: "asc" }, { fullName: "asc" }],
  });
}

export async function getUser(id: string) {
  await requirePermission(PERMISSIONS.ADMIN);

  return prisma.user.findUnique({
    where: { id },
    include: {
      role: true,
      department: { select: { id: true, name: true } },
      manager: { select: { id: true, fullName: true } },
      partner: { select: { id: true, partnerNumber: true, displayName: true } },
      reports: { select: { id: true, fullName: true, jobTitle: true, status: true } },
      teamMemberships: { include: { team: { select: { id: true, name: true } } } },
      projectMemberships: {
        where: { active: true },
        include: { project: { select: { id: true, name: true, projectNumber: true, status: true } } },
      },
    },
  });
}

export async function getUserFormOptions() {
  await requirePermission(PERMISSIONS.ADMIN);

  const [roles, departments, managers, partners] = await Promise.all([
    prisma.securityRole.findMany({
      where: { active: true },
      select: { id: true, name: true, description: true, dataScope: true, permissions: true },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({
      where: { deletedAt: null, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, fullName: true, jobTitle: true },
      orderBy: { fullName: "asc" },
    }),
    // Only partners without a login yet — one portal account each.
    prisma.partner.findMany({
      where: { deletedAt: null, portalUser: null },
      select: { id: true, partnerNumber: true, displayName: true, kind: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  return { roles, departments, managers, partners };
}

/** All partners, including those already holding a login — for the edit form. */
export async function getAllPartners() {
  await requirePermission(PERMISSIONS.ADMIN);

  return prisma.partner.findMany({
    where: { deletedAt: null },
    select: { id: true, partnerNumber: true, displayName: true, kind: true },
    orderBy: { displayName: "asc" },
  });
}
