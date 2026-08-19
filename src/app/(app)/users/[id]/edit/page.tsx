import { notFound } from "next/navigation";
import { getUser, getUserFormOptions, getAllPartners } from "@/server/users";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { UserForm, type UserDefaults, type UserFormOptions } from "../../user-form";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="user administration" />;

  const { id } = await params;

  const [user, options, allPartners] = await Promise.all([
    getUser(id),
    getUserFormOptions(),
    getAllPartners(),
  ]);
  if (!user) notFound();

  // The options list only offers partners without a login. On edit we also need
  // this user's own partner in the list, or their current value would vanish.
  const partners = user.partnerId
    ? allPartners.filter(
        (p) => p.id === user.partnerId || options.partners.some((o) => o.id === p.id),
      )
    : options.partners;

  const defaults = serialize({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    notificationEmail: user.notificationEmail ?? null,
    employeeNumber: user.employeeNumber,
    jobTitle: user.jobTitle,
    phone: user.phone,
    roleId: user.roleId,
    departmentId: user.departmentId,
    managerUserId: user.managerUserId,
    partnerId: user.partnerId,
    status: user.status,
    costRate: user.costRate,
    defaultBillingRate: user.defaultBillingRate,
  }) as unknown as UserDefaults;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${user.fullName}`} description={user.email} />
      <UserForm
        options={serialize({ ...options, partners }) as unknown as UserFormOptions}
        defaults={defaults}
      />
    </div>
  );
}
