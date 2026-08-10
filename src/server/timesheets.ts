"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, authorize, requirePermission, requireUser } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
import type { ActionResult } from "./partners";

/**
 * Timesheets (spec §10.4 Time Log).
 *
 * The workflow is the standard PSA one: DRAFT → SUBMITTED → APPROVED (or
 * REJECTED, which returns it to the author as a draft). Rates are captured on
 * the entry at submission time from the project membership, so re-rating
 * someone next year cannot rewrite what last year's work cost.
 *
 * Approval is deliberately someone else's job — `approveTimeLogs` requires the
 * `time:approve` permission and refuses your own entries.
 */

const HOURS_PER_DAY_CEILING = 24;

const timeLogSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  projectTaskId: z.string().uuid().optional().nullable(),
  caseId: z.string().uuid().optional().nullable(),
  workDate: z.coerce.date(),
  hours: z.coerce.number().positive().max(HOURS_PER_DAY_CEILING),
  description: z.string().min(1, "Say what you worked on."),
  billable: z.boolean().default(true),
});

/** Monday of the week containing `date`. Timesheets are Monday–Sunday. */
export async function startOfWeek(date: Date): Promise<Date> {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function weekBounds(weekStart: Date): { from: Date; to: Date } {
  const from = new Date(weekStart);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

export async function logTime(
  input: z.infer<typeof timeLogSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = timeLogSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // Mirrors the database's time_log_context_check.
  if (!data.projectId && !data.projectTaskId && !data.caseId) {
    return {
      ok: false,
      error: "Time has to be logged against a project, a task or a support case.",
      fieldErrors: { projectId: ["Pick something to book this against."] },
    };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // A task implies its project, even if the form only sent the task.
      let projectId = data.projectId ?? null;
      if (data.projectTaskId) {
        const task = await tx.projectTask.findUniqueOrThrow({
          where: { id: data.projectTaskId },
          select: { projectId: true, billable: true },
        });
        projectId = task.projectId;
      }

      if (projectId) {
        const member = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId: user.id } },
          select: { active: true, billingRate: true, costRate: true },
        });
        if (!member || !member.active) {
          throw new Error("You are not an active member of that project, so you cannot book time to it.");
        }

        return tx.timeLog.create({
          data: {
            userId: user.id,
            projectId,
            projectTaskId: data.projectTaskId ?? null,
            caseId: data.caseId ?? null,
            workDate: data.workDate,
            hours: data.hours,
            description: data.description,
            billable: data.billable,
            billingRate: member.billingRate,
            costRate: member.costRate,
            approvalStatus: "DRAFT",
          },
        });
      }

      // Support-case time: no project membership, so fall back to standing rates.
      const person = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { costRate: true, defaultBillingRate: true },
      });

      return tx.timeLog.create({
        data: {
          userId: user.id,
          caseId: data.caseId ?? null,
          workDate: data.workDate,
          hours: data.hours,
          description: data.description,
          billable: data.billable,
          billingRate: person.defaultBillingRate,
          costRate: person.costRate,
          approvalStatus: "DRAFT",
        },
      });
    });

    revalidatePath("/timesheets");
    if (created.projectId) revalidatePath(`/projects/${created.projectId}`);
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not log the time." };
  }
}

export async function updateTimeLog(
  id: string,
  input: z.infer<typeof timeLogSchema>,
): Promise<ActionResult> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = timeLogSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const existing = await prisma.timeLog.findUniqueOrThrow({ where: { id } });
    if (existing.userId !== user.id) {
      return { ok: false, error: "You can only edit your own time entries." };
    }
    if (existing.approvalStatus === "APPROVED") {
      return { ok: false, error: "Approved time is locked. Ask your approver to reject it first." };
    }

    await prisma.timeLog.update({
      where: { id },
      data: {
        workDate: parsed.data.workDate,
        hours: parsed.data.hours,
        description: parsed.data.description,
        billable: parsed.data.billable,
        approvalStatus: "DRAFT",
      },
    });

    revalidatePath("/timesheets");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the entry." };
  }
}

export async function deleteTimeLog(id: string): Promise<ActionResult> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    const existing = await prisma.timeLog.findUniqueOrThrow({ where: { id } });
    if (existing.userId !== user.id) {
      return { ok: false, error: "You can only delete your own time entries." };
    }
    if (existing.approvalStatus === "APPROVED") {
      return { ok: false, error: "Approved time cannot be deleted — it is part of the project's cost record." };
    }
    if (existing.invoiceLineId) {
      return { ok: false, error: "This time has already been invoiced." };
    }

    await prisma.timeLog.delete({ where: { id } });
    revalidatePath("/timesheets");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not delete the entry." };
  }
}

/** Submits a whole week for approval. */
export async function submitWeek(weekStartISO: string): Promise<ActionResult<{ count: number }>> {
  const _auth = await authorize();
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;
  const { from, to } = weekBounds(new Date(weekStartISO));

  try {
    const result = await prisma.timeLog.updateMany({
      where: {
        userId: user.id,
        workDate: { gte: from, lt: to },
        approvalStatus: { in: ["DRAFT", "REJECTED"] },
      },
      data: { approvalStatus: "SUBMITTED" },
    });

    if (result.count === 0) {
      return { ok: false, error: "There is nothing to submit for that week." };
    }

    revalidatePath("/timesheets");
    revalidatePath("/timesheets/approvals");
    return { ok: true, data: { count: result.count } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not submit the week." };
  }
}

export async function approveTimeLogs(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const _auth = await authorize(PERMISSIONS.TIME_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;
  if (ids.length === 0) return { ok: false, error: "Nothing selected." };

  try {
    const logs = await prisma.timeLog.findMany({
      where: { id: { in: ids } },
      select: { id: true, userId: true, approvalStatus: true, projectId: true },
    });

    if (logs.some((l) => l.userId === user.id)) {
      return { ok: false, error: "You cannot approve your own time." };
    }
    if (logs.some((l) => l.approvalStatus !== "SUBMITTED")) {
      return { ok: false, error: "Only submitted entries can be approved." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.timeLog.updateMany({
        where: { id: { in: ids } },
        data: { approvalStatus: "APPROVED", approvedById: user.id, approvedAt: new Date() },
      });

      for (const log of logs) {
        await auditChanges(tx, {
          entityType: "TimeLog",
          entityId: log.id,
          before: { approvalStatus: log.approvalStatus },
          after: { approvalStatus: "APPROVED" },
          changedById: user.id,
        });
      }
    });

    revalidatePath("/timesheets/approvals");
    revalidatePath("/timesheets");
    for (const p of new Set(logs.map((l) => l.projectId).filter(Boolean))) {
      revalidatePath(`/projects/${p}`);
    }
    return { ok: true, data: { count: logs.length } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not approve the time." };
  }
}

export async function rejectTimeLogs(ids: string[], reason: string): Promise<ActionResult<{ count: number }>> {
  const _auth = await authorize(PERMISSIONS.TIME_APPROVE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;
  if (ids.length === 0) return { ok: false, error: "Nothing selected." };
  if (!reason.trim()) return { ok: false, error: "Give a reason so the person knows what to fix." };

  try {
    const logs = await prisma.timeLog.findMany({
      where: { id: { in: ids } },
      select: { id: true, description: true, approvalStatus: true },
    });
    if (logs.some((l) => l.approvalStatus !== "SUBMITTED")) {
      return { ok: false, error: "Only submitted entries can be rejected." };
    }

    await prisma.$transaction(async (tx) => {
      for (const log of logs) {
        await tx.timeLog.update({
          where: { id: log.id },
          data: {
            approvalStatus: "REJECTED",
            approvedById: user.id,
            approvedAt: new Date(),
            description: `${log.description}\n\n[Rejected by ${user.fullName}: ${reason.trim()}]`,
          },
        });
        await auditChanges(tx, {
          entityType: "TimeLog",
          entityId: log.id,
          before: { approvalStatus: log.approvalStatus },
          after: { approvalStatus: "REJECTED" },
          changedById: user.id,
        });
      }
    });

    revalidatePath("/timesheets/approvals");
    revalidatePath("/timesheets");
    return { ok: true, data: { count: logs.length } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reject the time." };
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMyWeek(weekStartISO: string) {
  const user = await requireUser();
  const { from, to } = weekBounds(new Date(weekStartISO));

  const entries = await prisma.timeLog.findMany({
    where: { userId: user.id, workDate: { gte: from, lt: to } },
    include: {
      project: { select: { id: true, name: true, projectNumber: true } },
      projectTask: { select: { id: true, name: true } },
      case: { select: { id: true, caseNumber: true, subject: true } },
    },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
  });

  return { entries, from, to };
}

/** What the current user can book time against. */
export async function getTimeEntryOptions() {
  const user = await requireUser();

  const [memberships, cases] = await Promise.all([
    prisma.projectMember.findMany({
      where: { userId: user.id, active: true, project: { deletedAt: null, status: { in: ["PLANNING", "ACTIVE", "AT_RISK"] } } },
      select: {
        project: {
          select: {
            id: true,
            name: true,
            projectNumber: true,
            tasks: {
              where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
              select: { id: true, name: true, billable: true, assignedUserId: true },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.case.findMany({
      where: { deletedAt: null, ownerUserId: user.id, status: { notIn: ["CLOSED", "CANCELLED"] } },
      select: { id: true, caseNumber: true, subject: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { projects: memberships.map((m) => m.project), cases };
}

export async function getPendingApprovals() {
  const user = await requirePermission(PERMISSIONS.TIME_APPROVE);

  return prisma.timeLog.findMany({
    where: { approvalStatus: "SUBMITTED", userId: { not: user.id } },
    include: {
      user: { select: { id: true, fullName: true } },
      project: { select: { id: true, name: true, projectNumber: true } },
      projectTask: { select: { id: true, name: true } },
      case: { select: { id: true, caseNumber: true } },
    },
    orderBy: [{ workDate: "asc" }],
  });
}

/**
 * Resource utilisation: what each person is booked for versus what they have
 * actually logged, over a window. `allocationPercent` on a project membership
 * is a claim on their week; logged hours are the reality. The gap between the
 * two is the number a delivery manager actually needs.
 */
export async function getUtilisation(weeks = 4) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - weeks * 7);

  const STANDARD_WEEKLY_HOURS = 40;
  const capacityHours = new Prisma.Decimal(STANDARD_WEEKLY_HOURS * weeks);

  const [users, memberships, logs] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: {
        id: true, fullName: true, jobTitle: true, costRate: true, defaultBillingRate: true,
        department: { select: { id: true, name: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.projectMember.findMany({
      where: { active: true, project: { deletedAt: null, status: { in: ["PLANNING", "ACTIVE", "AT_RISK"] } } },
      select: {
        userId: true,
        allocationPercent: true,
        project: { select: { id: true, name: true, projectNumber: true } },
      },
    }),
    prisma.timeLog.groupBy({
      by: ["userId", "billable"],
      where: { workDate: { gte: from, lte: to }, approvalStatus: { not: "REJECTED" } },
      _sum: { hours: true },
    }),
  ]);

  return {
    from,
    to,
    weeks,
    capacityHours,
    rows: users.map((u) => {
      const theirProjects = memberships.filter((m) => m.userId === u.id);
      const allocatedPercent = theirProjects.reduce(
        (s, m) => s + Number(m.allocationPercent ?? 0),
        0,
      );
      const billable = logs.find((l) => l.userId === u.id && l.billable)?._sum.hours ?? new Prisma.Decimal(0);
      const nonBillable = logs.find((l) => l.userId === u.id && !l.billable)?._sum.hours ?? new Prisma.Decimal(0);
      const logged = new Prisma.Decimal(billable).plus(nonBillable);

      return {
        user: u,
        projects: theirProjects.map((m) => ({ ...m.project, allocationPercent: m.allocationPercent })),
        allocatedPercent,
        loggedHours: logged,
        billableHours: new Prisma.Decimal(billable),
        nonBillableHours: new Prisma.Decimal(nonBillable),
        /** Logged against a 40h week — the standard utilisation ratio. */
        utilisationPercent: capacityHours.isZero()
          ? 0
          : Number(logged.dividedBy(capacityHours).times(100).toDecimalPlaces(1)),
        billableUtilisationPercent: capacityHours.isZero()
          ? 0
          : Number(new Prisma.Decimal(billable).dividedBy(capacityHours).times(100).toDecimalPlaces(1)),
      };
    }),
  };
}
