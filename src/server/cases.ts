"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
import type { ActionResult } from "./partners";

/**
 * Support cases (spec §10.3).
 *
 * Two rules are enforced here rather than in the UI:
 *   - A case always belongs to an Account *and* to a Contact of that Account.
 *     The schema allows a null contact (cases can arrive from an unknown
 *     sender), but a case raised through this app must name the person.
 *   - An open case needs an owner or a team — the same rule the database's
 *     `case_assignment_check` constraint enforces, checked here first so the
 *     user gets a sentence instead of a Postgres error.
 */

const OPEN_STATUSES = [
  "NEW", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CUSTOMER",
  "WAITING_FOR_INTERNAL_TEAM", "WAITING_FOR_THIRD_PARTY", "REOPENED",
] as const;

const caseSchema = z.object({
  subject: z.string().min(1).max(500),
  description: z.string().min(1, "Describe what the customer reported."),
  accountId: z.string().uuid(),
  contactId: z.string().uuid({ message: "Pick the contact who raised this." }),
  categoryId: z.string().uuid().optional().nullable(),
  ownerUserId: z.string().uuid().optional().nullable(),
  teamId: z.string().uuid().optional().nullable(),
  slaPolicyId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  contractId: z.string().uuid().optional().nullable(),
  caseType: z.enum(["INCIDENT", "REQUEST", "QUESTION", "PROBLEM"]).default("INCIDENT"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  source: z.enum(["EMAIL", "PORTAL", "PHONE", "WHATSAPP", "INTERNAL"]).default("EMAIL"),
});

/**
 * Wall-clock SLA deadlines from the matching policy.
 *
 * NOTE: this is elapsed time, not business hours. `BusinessHours.weeklySchedule`
 * exists and the proper calendar walk belongs here — until it is written, a
 * policy of "4 hours" means four real hours, including overnight.
 */
async function slaDeadlines(
  slaPolicyId: string | null | undefined,
  priority: string,
  from: Date,
): Promise<{ slaPolicyId: string | null; firstResponseDueAt: Date | null; resolutionDueAt: Date | null }> {
  const policy = slaPolicyId
    ? await prisma.slaPolicy.findUnique({ where: { id: slaPolicyId } })
    : await prisma.slaPolicy.findFirst({
        where: { active: true, priority: priority as never },
      });

  if (!policy) return { slaPolicyId: null, firstResponseDueAt: null, resolutionDueAt: null };

  return {
    slaPolicyId: policy.id,
    firstResponseDueAt: new Date(from.getTime() + policy.firstResponseMinutes * 60_000),
    resolutionDueAt: new Date(from.getTime() + policy.resolutionMinutes * 60_000),
  };
}

export async function createCase(
  input: z.infer<typeof caseSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.CASE_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = caseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (!data.ownerUserId && !data.teamId) {
    return {
      ok: false,
      error: "An open case needs an owner or a team — otherwise nobody is answering it.",
      fieldErrors: { ownerUserId: ["Assign a person or a team."] },
    };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const contact = await tx.contact.findUnique({
        where: { id: data.contactId },
        select: { accountId: true, firstName: true, lastName: true },
      });
      if (!contact) throw new Error("That contact no longer exists.");
      if (contact.accountId !== data.accountId) {
        throw new Error(
          `${contact.firstName} ${contact.lastName} does not belong to the selected account.`,
        );
      }

      const now = new Date();
      const sla = await slaDeadlines(data.slaPolicyId, data.priority, now);

      return tx.case.create({
        data: {
          caseNumber: await nextNumber(SEQUENCES.CASE, tx),
          subject: data.subject,
          description: data.description,
          accountId: data.accountId,
          contactId: data.contactId,
          categoryId: data.categoryId ?? null,
          ownerUserId: data.ownerUserId ?? null,
          teamId: data.teamId ?? null,
          projectId: data.projectId ?? null,
          contractId: data.contractId ?? null,
          caseType: data.caseType,
          priority: data.priority,
          source: data.source,
          status: data.ownerUserId ? "ASSIGNED" : "NEW",
          slaPolicyId: sla.slaPolicyId,
          firstResponseDueAt: sla.firstResponseDueAt,
          resolutionDueAt: sla.resolutionDueAt,
        },
      });
    });

    revalidatePath("/cases");
    revalidatePath(`/accounts/${data.accountId}`);
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the case." };
  }
}

const caseUpdateSchema = caseSchema.extend({
  status: z.enum([
    "NEW", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CUSTOMER",
    "WAITING_FOR_INTERNAL_TEAM", "WAITING_FOR_THIRD_PARTY",
    "RESOLVED", "CLOSED", "REOPENED", "CANCELLED",
  ]),
  rootCause: z.string().optional().nullable(),
  resolution: z.string().optional().nullable(),
  satisfactionScore: z.coerce.number().int().min(1).max(5).optional().nullable(),
});

export async function updateCase(
  id: string,
  input: z.infer<typeof caseUpdateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.CASE_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = caseUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const stillOpen = (OPEN_STATUSES as readonly string[]).includes(data.status);
  if (stillOpen && !data.ownerUserId && !data.teamId) {
    return {
      ok: false,
      error: "An open case needs an owner or a team.",
      fieldErrors: { ownerUserId: ["Assign a person or a team."] },
    };
  }
  if ((data.status === "RESOLVED" || data.status === "CLOSED") && !data.resolution) {
    return {
      ok: false,
      error: "Record what actually fixed it before resolving or closing.",
      fieldErrors: { resolution: ["A resolution is required."] },
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.case.findUniqueOrThrow({ where: { id } });

      const contact = await tx.contact.findUnique({
        where: { id: data.contactId },
        select: { accountId: true },
      });
      if (!contact || contact.accountId !== data.accountId) {
        throw new Error("The contact must belong to the selected account.");
      }

      const now = new Date();
      const reopening = before.status !== "REOPENED" && data.status === "REOPENED";
      const resolving = !before.resolvedAt && (data.status === "RESOLVED" || data.status === "CLOSED");

      const after = await tx.case.update({
        where: { id },
        data: {
          subject: data.subject,
          description: data.description,
          accountId: data.accountId,
          contactId: data.contactId,
          categoryId: data.categoryId ?? null,
          ownerUserId: data.ownerUserId ?? null,
          teamId: data.teamId ?? null,
          projectId: data.projectId ?? null,
          contractId: data.contractId ?? null,
          caseType: data.caseType,
          priority: data.priority,
          source: data.source,
          status: data.status,
          rootCause: data.rootCause ?? null,
          resolution: data.resolution ?? null,
          satisfactionScore: data.satisfactionScore ?? null,
          resolvedAt: resolving ? now : data.status === "REOPENED" ? null : before.resolvedAt,
          closedAt: data.status === "CLOSED" ? now : data.status === "REOPENED" ? null : before.closedAt,
          reopenCount: reopening ? before.reopenCount + 1 : before.reopenCount,
          // §10.3: record whether the SLA was actually met, not just its deadline.
          slaBreached:
            resolving && before.resolutionDueAt
              ? now > before.resolutionDueAt
              : before.slaBreached,
        },
      });

      await auditChanges(tx, {
        entityType: "Case",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/cases");
    revalidatePath(`/cases/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the case." };
  }
}

/** Marks the first response, which is what SLA attainment is measured against. */
export async function recordFirstResponse(id: string): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.CASE_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.case.findUniqueOrThrow({ where: { id } });
      if (before.firstRespondedAt) throw new Error("First response is already recorded.");

      const now = new Date();
      const after = await tx.case.update({
        where: { id },
        data: {
          firstRespondedAt: now,
          status: before.status === "NEW" ? "IN_PROGRESS" : before.status,
          slaBreached:
            before.firstResponseDueAt && now > before.firstResponseDueAt ? true : before.slaBreached,
        },
      });

      await auditChanges(tx, {
        entityType: "Case",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath(`/cases/${id}`);
    revalidatePath("/cases");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not record the response." };
  }
}

export async function getCase(id: string) {
  await requirePermission(PERMISSIONS.CASE_READ);

  return prisma.case.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, accountNumber: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      owner: { select: { id: true, fullName: true, email: true } },
      team: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      slaPolicy: { select: { id: true, name: true, firstResponseMinutes: true, resolutionMinutes: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
      contract: { select: { id: true, contractNumber: true } },
    },
  });
}

/** Everything the case form's dropdowns need. */
export async function getCaseFormOptions() {
  await requirePermission(PERMISSIONS.CASE_READ);

  const [accounts, contacts, users, teams, categories, slaPolicies] = await Promise.all([
    prisma.account.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.contact.findMany({
      where: { deletedAt: null, accountId: { not: null } },
      select: { id: true, firstName: true, lastName: true, email: true, accountId: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.caseCategory.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.slaPolicy.findMany({
      where: { active: true },
      select: { id: true, name: true, priority: true, firstResponseMinutes: true, resolutionMinutes: true },
      orderBy: { priority: "asc" },
    }),
  ]);

  return { accounts, contacts, users, teams, categories, slaPolicies };
}
