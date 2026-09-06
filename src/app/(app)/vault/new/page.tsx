import { getVaultFormOptions } from "@/server/secrets";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { SecretForm, type SecretFormOptions } from "../secret-form";

export default async function NewSecretPage() {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.SECRET_WRITE)) return <Forbidden what="the vault" />;

  const options = await getVaultFormOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo="/vault"
        backLabel="Back to the vault"
        title="Add a secret"
        description="The value is encrypted before it is stored. Reading it back is possible, and every read is recorded."
      />
      <SecretForm
        options={serialize(options) as unknown as SecretFormOptions}
        currentUserId={user.id}
      />
    </div>
  );
}
