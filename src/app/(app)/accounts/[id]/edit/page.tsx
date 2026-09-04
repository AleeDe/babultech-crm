import { notFound } from "next/navigation";
import { getAccount, getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { AccountForm, type AccountDefaults } from "../../account-form";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, PERMISSIONS.ACCOUNT_WRITE)) return <Forbidden what="accounts" />;
  const [account, options] = await Promise.all([getAccount(id), getFormOptions()]);
  if (!account) notFound();

  const defaults = serialize({
    id: account.id,
    name: account.name,
    accountType: account.accountType,
    customerStatus: account.customerStatus,
    parentAccountId: account.parentAccountId,
    ownerUserId: account.ownerUserId,
    industry: account.industry,
    website: account.website,
    mainPhone: account.mainPhone,
    taxNumberNtn: account.taxNumberNtn,
    creditLimit: account.creditLimit,
    paymentTermsDays: account.paymentTermsDays,
    customerHealth: account.customerHealth,
    description: account.description,
    billingAddress: account.billingAddress,
  }) as unknown as AccountDefaults;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo={`/accounts/${id}`}
        backLabel="Back to the account"
        title={`Edit ${account.name}`} description={account.accountNumber} />
      <AccountForm
        options={serialize({ users: options.users, accounts: options.accounts })}
        defaults={defaults}
        currentUserId={user.id}
      />
    </div>
  );
}
