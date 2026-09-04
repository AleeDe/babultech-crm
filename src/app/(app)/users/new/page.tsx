import { getUserFormOptions } from "@/server/users";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { UserForm, type UserFormOptions } from "../user-form";

export default async function NewUserPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="user administration" />;

  const options = await getUserFormOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo="/users"
        backLabel="Back to users"
        title="New user"
        description="A login, a profile and a role. Pick the role first - it changes what the rest of the form asks for."
      />
      <UserForm options={serialize(options) as unknown as UserFormOptions} />
    </div>
  );
}
