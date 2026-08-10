"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
import type { ActionResult } from "./partners";

/**
 * Project delivery (spec §10.4).
 *
 * The shape follows how a professional-services engagement is actually run:
 * a project holds phases, phases hold milestones and tasks, people are booked
 * onto the project as members with an allocation percentage and rates, and
 * time is logged against tasks. Progress rolls **up** — task completion drives
 * phase completion drives project completion — rather than being typed in by
 * hand, so the number on the dashboard cannot drift from the work.
 */

// ---------------------------------------------------------------------------
// Progress roll-up
// ---------------------------------------------------------------------------

/**
 * Recomputes phase and project completion from task data.
 *
 * Tasks are weighted by estimated hours where they have them, so a 40-hour
 * task counts for more than a 2-hour one. Tasks with no estimate fall back to
 * equal weighting, which is the honest default when nobody has estimated yet.
 * Cancelled tasks drop out of the calculation entirely.
 */
async function rollUpProgress(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
  const tasks = await tx.projectTask.findMany({
    where: { projectId, status: { not: "CANCELLED" } },
    select: { id: true, phaseId: true, estimatedHours: true, completionPercent: true, status: true },
  });

  const weightOf = (t: (typeof tasks)[number]) => {
    const hours = Number(t.estimatedHours ?? 0);
    return hours > 0 ? hours : 1;
  };
  const progressOf = (t: (typeof tasks)[number]) =>
    t.status === "COMPLETED" ? 100 : Number(t.completionPercent);

  const weighted = (subset: typeof tasks) => {
    if (subset.length === 0) return null;
    const totalWeight = subset.reduce((s, t) => s + weightOf(t), 0);
    if (totalWeight === 0) return null;
    const done = subset.reduce((s, t) => s + weightOf(t) * progressOf(t), 0);
    return Math.round((done / totalWeight) * 100) / 100;
  };

  const phases = await tx.projectPhase.findMany({
    where: { projectId },
    select: { id: true },
  });

  for (const phase of phases) {
    const pct = weighted(tasks.filter((t) => t.phaseId === phase.id));
    if (pct === null) continue;
    await tx.projectPhase.update({
      where: { id: phase.id },
      data: {
        completionPercent: pct,
        status: pct >= 100 ? "COMPLETED" : pct > 0 ? "ACTIVE" : "NOT_STARTED",
      },
    });
  }

  const overall = weighted(tasks);
  if (overall !== null) {
    await tx.project.update({
      where: { id: projectId },
      data: { completionPercent: overall },
    });
  }
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

const projectSchema = z.object({
  name: z.string().min(1).max(255),
  accountId: z.string().uuid(),
  opportunityId: z.string().uuid().optional().nullable(),
  contractId: z.string().uuid().optional().nullable(),
  projectManagerId: z.string().uuid(),
  status: z
    .enum(["DRAFT", "PLANNING", "ACTIVE", "ON_HOLD", "AT_RISK", "COMPLETED", "CANCELLED"])
    .default("DRAFT"),
  health: z.enum(["GREEN", "AMBER", "RED"]).default("GREEN"),
  billingType: z.enum(["FIXED", "HOURLY", "RETAINER", "MILESTONE", "ANNUAL"]),
  startDate: z.coerce.date().optional().nullable(),
  plannedEndDate: z.coerce.date().optional().nullable(),
  actualEndDate: z.coerce.date().optional().nullable(),
  contractValue: z.coerce.number().min(0).optional().nullable(),
  currencyCode: z.string().length(3).default("PKR"),
  approvedHours: z.coerce.number().min(0).optional().nullable(),
  scope: z.string().optional().nullable(),
});

export async function createProject(
  input: z.infer<typeof projectSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.startDate && data.plannedEndDate && data.plannedEndDate < data.startDate) {
    return {
      ok: false,
      error: "The planned end date cannot fall before the start date.",
      fieldErrors: { plannedEndDate: ["Must be on or after the start date."] },
    };
  }

  try {
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          ...data,
          projectNumber: await nextNumber(SEQUENCES.PROJECT, tx),
        },
      });

      // The project manager is a member of their own project by default —
      // otherwise they cannot log time against it. Their standing rates come
      // across too, the same way addProjectMember does it, or their time would
      // book at zero cost and quietly overstate the margin.
      const manager = await tx.user.findUniqueOrThrow({
        where: { id: data.projectManagerId },
        select: { costRate: true, defaultBillingRate: true },
      });

      await tx.projectMember.create({
        data: {
          projectId: created.id,
          userId: data.projectManagerId,
          projectRole: "Project Manager",
          allocationPercent: 50,
          startDate: data.startDate ?? null,
          endDate: data.plannedEndDate ?? null,
          billingRate: manager.defaultBillingRate,
          costRate: manager.costRate,
        },
      });

      return created;
    });

    revalidatePath("/projects");
    return { ok: true, data: { id: project.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the project." };
  }
}

export async function updateProject(
  id: string,
  input: z.infer<typeof projectSchema>,
): Promise<ActionResult<{ id: string }>> {
  const user = await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.startDate && data.plannedEndDate && data.plannedEndDate < data.startDate) {
    return {
      ok: false,
      error: "The planned end date cannot fall before the start date.",
      fieldErrors: { plannedEndDate: ["Must be on or after the start date."] },
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.project.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { tasks: true } } },
      });

      if (data.status === "COMPLETED") {
        const openTasks = await tx.projectTask.count({
          where: { projectId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        });
        if (openTasks > 0) {
          throw new Error(
            `${openTasks} task(s) are still open. Complete or cancel them before closing the project.`,
          );
        }
      }

      const after = await tx.project.update({
        where: { id },
        data: {
          ...data,
          actualEndDate:
            data.status === "COMPLETED" ? (data.actualEndDate ?? new Date()) : data.actualEndDate,
        },
      });

      await auditChanges(tx, {
        entityType: "Project",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the project." };
  }
}

export async function listProjects(filters?: { status?: string; search?: string; managerId?: string }) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  return prisma.project.findMany({
    where: {
      deletedAt: null,
      ...(filters?.status ? { status: filters.status as never } : {}),
      ...(filters?.managerId ? { projectManagerId: filters.managerId } : {}),
      ...(filters?.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" as const } },
              { projectNumber: { contains: filters.search, mode: "insensitive" as const } },
              { account: { name: { contains: filters.search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: {
      account: { select: { id: true, name: true } },
      projectManager: { select: { id: true, fullName: true } },
      _count: { select: { members: true, tasks: true, milestones: true, issues: true, risks: true } },
    },
    orderBy: { startDate: "desc" },
  });
}

export async function getProject(id: string) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  return prisma.project.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, name: true, accountNumber: true } },
      opportunity: { select: { id: true, opportunityNumber: true, name: true } },
      contract: { select: { id: true, contractNumber: true } },
      projectManager: { select: { id: true, fullName: true, email: true } },
      phases: { orderBy: { sequenceNumber: "asc" } },
      milestones: {
        include: { owner: { select: { id: true, fullName: true } }, phase: { select: { id: true, name: true } } },
        orderBy: { dueDate: "asc" },
      },
      tasks: {
        include: {
          assignedUser: { select: { id: true, fullName: true } },
          phase: { select: { id: true, name: true } },
          milestone: { select: { id: true, name: true } },
          _count: { select: { subtasks: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      members: {
        include: { user: { select: { id: true, fullName: true, jobTitle: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
      risks: { include: { owner: { select: { id: true, fullName: true } } }, orderBy: { riskScore: "desc" } },
      issues: { include: { owner: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "desc" } },
      changeRequests: { orderBy: { createdAt: "desc" } },
      cases: { select: { id: true, caseNumber: true, subject: true, status: true, priority: true } },
    },
  });
}

/** Hours and money actually consumed, for the workspace tiles. */
export async function getProjectBurn(projectId: string) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  const [logged, approved] = await Promise.all([
    prisma.timeLog.aggregate({
      where: { projectId, approvalStatus: { not: "REJECTED" } },
      _sum: { hours: true },
    }),
    prisma.timeLog.findMany({
      where: { projectId, approvalStatus: "APPROVED" },
      select: { hours: true, billable: true, billingRate: true, costRate: true },
    }),
  ]);

  let billableValue = new Prisma.Decimal(0);
  let cost = new Prisma.Decimal(0);
  for (const log of approved) {
    const hours = new Prisma.Decimal(log.hours);
    if (log.billable && log.billingRate) billableValue = billableValue.plus(hours.times(log.billingRate));
    if (log.costRate) cost = cost.plus(hours.times(log.costRate));
  }

  return {
    loggedHours: logged._sum.hours ?? new Prisma.Decimal(0),
    billableValue,
    cost,
  };
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const phaseSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(200),
  ownerUserId: z.string().uuid().optional().nullable(),
  plannedStart: z.coerce.date().optional().nullable(),
  plannedEnd: z.coerce.date().optional().nullable(),
  budgetedHours: z.coerce.number().min(0).optional().nullable(),
});

export async function createPhase(
  input: z.infer<typeof phaseSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = phaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const phase = await prisma.$transaction(async (tx) => {
      const last = await tx.projectPhase.findFirst({
        where: { projectId: data.projectId },
        orderBy: { sequenceNumber: "desc" },
        select: { sequenceNumber: true },
      });
      return tx.projectPhase.create({
        data: { ...data, sequenceNumber: (last?.sequenceNumber ?? 0) + 1 },
      });
    });

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: phase.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add the phase." };
  }
}

export async function deletePhase(id: string): Promise<ActionResult> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  try {
    const phase = await prisma.projectPhase.findUniqueOrThrow({
      where: { id },
      select: { projectId: true, _count: { select: { tasks: true, milestones: true } } },
    });
    if (phase._count.tasks > 0 || phase._count.milestones > 0) {
      return {
        ok: false,
        error: "Move its tasks and milestones to another phase before deleting this one.",
      };
    }

    await prisma.projectPhase.delete({ where: { id } });
    revalidatePath(`/projects/${phase.projectId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not delete the phase." };
  }
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

const milestoneSchema = z.object({
  projectId: z.string().uuid(),
  phaseId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  ownerUserId: z.string().uuid().optional().nullable(),
  dueDate: z.coerce.date(),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"]).default("PLANNED"),
  customerApprovalRequired: z.boolean().default(false),
  billingTrigger: z.boolean().default(false),
  billingPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  billingAmount: z.coerce.number().min(0).optional().nullable(),
});

export async function createMilestone(
  input: z.infer<typeof milestoneSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = milestoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // §13 milestone billing: a billing milestone must say what it bills.
  if (data.billingTrigger && !data.billingAmount && !data.billingPercent) {
    return {
      ok: false,
      error: "A billing milestone needs either an amount or a percentage of the contract value.",
      fieldErrors: { billingAmount: ["Set an amount or a percentage."] },
    };
  }

  try {
    const milestone = await prisma.milestone.create({ data });
    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: milestone.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add the milestone." };
  }
}

export async function completeMilestone(
  id: string,
  customerApproved: boolean,
): Promise<ActionResult> {
  const user = await requirePermission(PERMISSIONS.PROJECT_WRITE);

  try {
    const milestone = await prisma.$transaction(async (tx) => {
      const before = await tx.milestone.findUniqueOrThrow({ where: { id } });

      if (before.customerApprovalRequired && !customerApproved && !before.customerApprovalDate) {
        throw new Error(
          "This milestone needs customer sign-off before it can be marked complete.",
        );
      }

      const openTasks = await tx.projectTask.count({
        where: { milestoneId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      });
      if (openTasks > 0) {
        throw new Error(`${openTasks} task(s) under this milestone are still open.`);
      }

      const now = new Date();
      const after = await tx.milestone.update({
        where: { id },
        data: {
          status: "COMPLETED",
          completedDate: now,
          customerApprovalDate:
            before.customerApprovalRequired && customerApproved
              ? (before.customerApprovalDate ?? now)
              : before.customerApprovalDate,
        },
      });

      await auditChanges(tx, {
        entityType: "Milestone",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });

      return after;
    });

    revalidatePath(`/projects/${milestone.projectId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not complete the milestone." };
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const taskSchema = z.object({
  projectId: z.string().uuid(),
  phaseId: z.string().uuid().optional().nullable(),
  milestoneId: z.string().uuid().optional().nullable(),
  parentTaskId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  assignedUserId: z.string().uuid().optional().nullable(),
  status: z
    .enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "UNDER_REVIEW", "COMPLETED", "CANCELLED"])
    .default("NOT_STARTED"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  startDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  estimatedHours: z.coerce.number().min(0).optional().nullable(),
  completionPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  billable: z.boolean().default(true),
  acceptanceCriteria: z.string().optional().nullable(),
});

async function assertAssigneeIsOnProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  const member = await tx.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { active: true },
  });
  if (!member || !member.active) {
    const person = await tx.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    throw new Error(
      `${person?.fullName ?? "That user"} is not an active member of this project. Add them to the team first.`,
    );
  }
}

export async function createTask(
  input: z.infer<typeof taskSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
    return {
      ok: false,
      error: "The due date cannot fall before the start date.",
      fieldErrors: { dueDate: ["Must be on or after the start date."] },
    };
  }

  try {
    const task = await prisma.$transaction(async (tx) => {
      await assertAssigneeIsOnProject(tx, data.projectId, data.assignedUserId);

      const last = await tx.projectTask.findFirst({
        where: { projectId: data.projectId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });

      const created = await tx.projectTask.create({
        data: {
          ...data,
          completionPercent: data.completionPercent ?? 0,
          sortOrder: (last?.sortOrder ?? 0) + 1,
        },
      });

      await rollUpProgress(tx, data.projectId);
      return created;
    });

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: task.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the task." };
  }
}

export async function updateTask(
  id: string,
  input: z.infer<typeof taskSchema>,
): Promise<ActionResult<{ id: string }>> {
  const user = await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
    return {
      ok: false,
      error: "The due date cannot fall before the start date.",
      fieldErrors: { dueDate: ["Must be on or after the start date."] },
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.projectTask.findUniqueOrThrow({ where: { id } });
      await assertAssigneeIsOnProject(tx, data.projectId, data.assignedUserId);

      if (data.status === "COMPLETED") {
        const openSubtasks = await tx.projectTask.count({
          where: { parentTaskId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        });
        if (openSubtasks > 0) {
          throw new Error(`${openSubtasks} subtask(s) are still open.`);
        }
      }

      const completing = data.status === "COMPLETED";
      const after = await tx.projectTask.update({
        where: { id },
        data: {
          ...data,
          completionPercent: completing ? 100 : (data.completionPercent ?? before.completionPercent),
          completedDate: completing ? (before.completedDate ?? new Date()) : null,
        },
      });

      await auditChanges(tx, {
        entityType: "ProjectTask",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });

      await rollUpProgress(tx, data.projectId);
    });

    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the task." };
  }
}

/** Board drag / quick status change — the one-field version of updateTask. */
export async function changeTaskStatus(
  id: string,
  status: string,
): Promise<ActionResult> {
  const user = await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = z
    .enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "UNDER_REVIEW", "COMPLETED", "CANCELLED"])
    .safeParse(status);
  if (!parsed.success) return { ok: false, error: "Unknown task status." };

  try {
    const projectId = await prisma.$transaction(async (tx) => {
      const before = await tx.projectTask.findUniqueOrThrow({ where: { id } });

      if (parsed.data === "COMPLETED") {
        const openSubtasks = await tx.projectTask.count({
          where: { parentTaskId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        });
        if (openSubtasks > 0) throw new Error(`${openSubtasks} subtask(s) are still open.`);
      }

      const completing = parsed.data === "COMPLETED";
      const after = await tx.projectTask.update({
        where: { id },
        data: {
          status: parsed.data,
          completionPercent: completing ? 100 : before.completionPercent,
          completedDate: completing ? (before.completedDate ?? new Date()) : null,
        },
      });

      await auditChanges(tx, {
        entityType: "ProjectTask",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });

      await rollUpProgress(tx, before.projectId);
      return before.projectId;
    });

    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not change the task." };
  }
}

export async function getTask(id: string) {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  return prisma.projectTask.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, projectNumber: true } },
      phase: { select: { id: true, name: true } },
      milestone: { select: { id: true, name: true } },
      parentTask: { select: { id: true, name: true } },
      subtasks: {
        select: { id: true, name: true, status: true, completionPercent: true },
        orderBy: { sortOrder: "asc" },
      },
      assignedUser: { select: { id: true, fullName: true } },
      timeLogs: {
        include: { user: { select: { id: true, fullName: true } } },
        orderBy: { workDate: "desc" },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Resources — people booked onto the project
// ---------------------------------------------------------------------------

const memberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  projectRole: z.string().min(1).max(100),
  allocationPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  billingRate: z.coerce.number().min(0).optional().nullable(),
  costRate: z.coerce.number().min(0).optional().nullable(),
});

/**
 * Books a person onto a project. Rates default to the person's standing rates
 * from their user record, so a project only carries an override when someone
 * has actually negotiated one.
 */
export async function addProjectMember(
  input: z.infer<typeof memberSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: data.projectId, userId: data.userId } },
      select: { id: true },
    });
    if (existing) {
      return { ok: false, error: "That person is already on this project." };
    }

    const person = await prisma.user.findUniqueOrThrow({
      where: { id: data.userId },
      select: { costRate: true, defaultBillingRate: true },
    });

    const member = await prisma.projectMember.create({
      data: {
        ...data,
        billingRate: data.billingRate ?? person.defaultBillingRate,
        costRate: data.costRate ?? person.costRate,
      },
    });

    revalidatePath(`/projects/${data.projectId}`);
    revalidatePath("/resources");
    return { ok: true, data: { id: member.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add the team member." };
  }
}

export async function updateProjectMember(
  id: string,
  input: Omit<z.infer<typeof memberSchema>, "projectId" | "userId"> & { active: boolean },
): Promise<ActionResult> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const schema = memberSchema
    .omit({ projectId: true, userId: true })
    .extend({ active: z.boolean() });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const member = await prisma.projectMember.update({
      where: { id },
      data: parsed.data,
      select: { projectId: true },
    });

    revalidatePath(`/projects/${member.projectId}`);
    revalidatePath("/resources");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the team member." };
  }
}

/**
 * Removes someone from a project. If they have logged time we deactivate
 * instead of deleting — their hours are part of the project's cost record and
 * must not lose their owner.
 */
export async function removeProjectMember(id: string): Promise<ActionResult<{ deactivated: boolean }>> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  try {
    const member = await prisma.projectMember.findUniqueOrThrow({
      where: { id },
      select: { id: true, projectId: true, userId: true },
    });

    const logged = await prisma.timeLog.count({
      where: { projectId: member.projectId, userId: member.userId },
    });

    if (logged > 0) {
      await prisma.projectMember.update({ where: { id }, data: { active: false, endDate: new Date() } });
    } else {
      await prisma.projectMember.delete({ where: { id } });
    }

    revalidatePath(`/projects/${member.projectId}`);
    revalidatePath("/resources");
    return { ok: true, data: { deactivated: logged > 0 } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not remove the team member." };
  }
}

// ---------------------------------------------------------------------------
// Risks and issues (RAID)
// ---------------------------------------------------------------------------

const riskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  probability: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  impact: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  mitigationPlan: z.string().optional().nullable(),
  ownerUserId: z.string().uuid(),
  targetDate: z.coerce.date().optional().nullable(),
  status: z.enum(["OPEN", "MONITORING", "MITIGATED", "CLOSED"]).default("OPEN"),
});

/** Standard probability x impact matrix, 1–16. */
const LEVEL_SCORE: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export async function createRisk(
  input: z.infer<typeof riskSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = riskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const risk = await prisma.projectRisk.create({
      data: {
        ...data,
        riskScore: LEVEL_SCORE[data.probability] * LEVEL_SCORE[data.impact],
      },
    });
    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: risk.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not log the risk." };
  }
}

const issueSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  ownerUserId: z.string().uuid(),
  resolutionPlan: z.string().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).default("OPEN"),
});

export async function createIssue(
  input: z.infer<typeof issueSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requirePermission(PERMISSIONS.PROJECT_WRITE);

  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const issue = await prisma.projectIssue.create({ data });
    revalidatePath(`/projects/${data.projectId}`);
    return { ok: true, data: { id: issue.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not log the issue." };
  }
}

// ---------------------------------------------------------------------------
// Form options
// ---------------------------------------------------------------------------

export async function getProjectFormOptions() {
  await requirePermission(PERMISSIONS.PROJECT_READ);

  const [accounts, users, opportunities, contracts, currencies] = await Promise.all([
    prisma.account.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: {
        id: true, fullName: true, jobTitle: true,
        costRate: true, defaultBillingRate: true,
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.opportunity.findMany({
      where: { deletedAt: null, stage: "CLOSED_WON" },
      select: { id: true, opportunityNumber: true, name: true, accountId: true },
      orderBy: { name: "asc" },
    }),
    prisma.contract.findMany({
      where: { deletedAt: null },
      select: { id: true, contractNumber: true, accountId: true },
      orderBy: { contractNumber: "asc" },
    }),
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);

  return { accounts, users, opportunities, contracts, currencies };
}
