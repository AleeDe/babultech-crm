import { prisma } from "@/lib/prisma";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { PartnerForm } from "./partner-form";

export default async function NewPartnerPage() {
  await requirePermission(PERMISSIONS.PARTNER_WRITE);

  const [users, accounts, contacts, plans, currencies] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.account.findMany({
      where: { deletedAt: null, partner: null },
      select: { id: true, name: true, accountType: true },
      orderBy: { name: "asc" },
    }),
    prisma.contact.findMany({
      where: { deletedAt: null, partnerAsPerson: null },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ lastName: "asc" }],
    }),
    prisma.commissionPlan.findMany({
      where: { deletedAt: null, active: true },
      select: { id: true, name: true, rateType: true, flatPercent: true },
      orderBy: { name: "asc" },
    }),
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Add partner"
        description="A partner can be a company or a single person. Individuals are stored as a contact with no account, so nothing fake ends up in your customer list."
      />
      <PartnerForm options={serialize({ users, accounts, contacts, plans, currencies })} />
    </div>
  );
}
