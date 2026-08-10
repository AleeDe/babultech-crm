import { getFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { AccountForm } from "../account-form";

export default async function NewAccountPage() {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.ACCOUNT_WRITE)) return <Forbidden what="accounts" />;
  const options = await getFormOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="New account"
        description="One organisation record. Its type decides what it can do — only a Partner account can carry a partner profile."
      />
      <AccountForm
        options={serialize({ users: options.users, accounts: options.accounts })}
        currentUserId={user.id}
      />
    </div>
  );
}
