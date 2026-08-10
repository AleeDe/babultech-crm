"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { nextNumber, SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { auditChanges } from "@/lib/audit";
import type { ActionResult } from "./partners";

/**
 * Contracts (spec §10.2). A contract is normally the accepted quote turned
 * into a term — so `createContract` can seed itself from a quotation and keeps
 * the link, which is also how commission finds its way from a project invoice
 * back to the originating opportunity.
 */

const contractSchema = z.object({
  name: z.string().min(1).max(255),
  accountId: z.string().uuid(),
  opportunityId: z.string().uuid().optional().nullable(),
  quotationId: z.string().uuid().optional().nullable(),
  ownerUserId: z.string().uuid(),
  contractType: z.string().min(1).max(100),
  status: z
    .enum(["DRAFT", "UNDER_REVIEW", "SENT_FOR_SIGNATURE", "ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"])
    .default("DRAFT"),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  contractValue: z.coerce.number().min(0),
  currencyCode: z.string().length(3).default("PKR"),
  billingFrequency: z.enum(["ONE_TIME", "MONTHLY", "QUARTERLY", "MILESTONE", "ANNUAL"]).optional().nullable(),
  renewalType: z.enum(["MANUAL", "AUTO_RENEW"]).optional().nullable(),
  noticePeriodDays: z.coerce.number().int().min(0).optional().nullable(),
  signedDate: z.coerce.date().optional().nullable(),
  terminationReason: z.string().optional().nullable(),
});

function validate(data: z.infer<typeof contractSchema>): ActionResult<never> | null {
  if (data.endDate < data.startDate) {
    return {
      ok: false,
      error: "A contract cannot end before it starts.",
      fieldErrors: { endDate: ["Must be on or after the start date."] },
    };
  }
  if (data.status === "ACTIVE" && !data.signedDate) {
    return {
      ok: false,
      error: "An active contract needs a signature date — otherwise nothing says the customer agreed.",
      fieldErrors: { signedDate: ["Required before a contract can go active."] },
    };
  }
  if (data.status === "TERMINATED" && !data.terminationReason) {
    return {
      ok: false,
      error: "Record why the contract was terminated.",
      fieldErrors: { terminationReason: ["A reason is required."] },
    };
  }
  return null;
}

export async function createContract(
  input: z.infer<typeof contractSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.CONTRACT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = contractSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const invalid = validate(parsed.data);
  if (invalid) return invalid;

  try {
    const contract = await prisma.$transaction(async (tx) =>
      tx.contract.create({
        data: { ...parsed.data, contractNumber: await nextNumber(SEQUENCES.CONTRACT, tx) },
      }),
    );

    revalidatePath("/contracts");
    return { ok: true, data: { id: contract.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the contract." };
  }
}

export async function updateContract(
  id: string,
  input: z.infer<typeof contractSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.CONTRACT_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = contractSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const invalid = validate(parsed.data);
  if (invalid) return invalid;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.contract.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { invoices: true, projects: true } } },
      });

      if (parsed.data.status === "TERMINATED" && before._count.projects > 0) {
        const live = await tx.project.count({
          where: { contractId: id, status: { in: ["PLANNING", "ACTIVE", "AT_RISK"] } },
        });
        if (live > 0) {
          throw new Error(
            `${live} project(s) are still running under this contract. Close them before terminating it.`,
          );
        }
      }

      const after = await tx.contract.update({ where: { id }, data: parsed.data });

      await auditChanges(tx, {
        entityType: "Contract",
        entityId: id,
        before,
        after,
        changedById: user.id,
      });
    });

    revalidatePath("/contracts");
    revalidatePath(`/contracts/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the contract." };
  }
}

export async function getContract(id: string) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);
  return prisma.contract.findUnique({ where: { id } });
}

export async function getContractFormOptions() {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  const [accounts, users, opportunities, quotations, currencies] = await Promise.all([
    prisma.account.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.opportunity.findMany({
      where: { deletedAt: null },
      select: { id: true, opportunityNumber: true, name: true, accountId: true },
      orderBy: { name: "asc" },
    }),
    prisma.quotation.findMany({
      where: { deletedAt: null, status: "ACCEPTED" },
      select: {
        id: true, quoteNumber: true, versionNumber: true, accountId: true,
        opportunityId: true, totalAmount: true, currencyCode: true,
      },
      orderBy: { quoteNumber: "asc" },
    }),
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);

  return { accounts, users, opportunities, quotations, currencies };
}
