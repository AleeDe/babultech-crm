import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listSenders } from "@/server/communications";
import { PageHeader, Forbidden, Alert } from "@/components/ui";
import { SendersEditor } from "./senders-editor";

export default async function EmailSendersPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="sender addresses" />;
  const { senders, domain } = await listSenders();
  return (
    <>
      <PageHeader
        title="Sender addresses"
        description="The names and addresses mass email can be sent as. The default is chosen first when composing."
      />
      {domain ? (
        <div className="mb-4">
          <Alert tone="info">
            Addresses must end in <strong>@{domain}</strong>, the domain the mail provider is set up to send for. Replies
            go to the reply-to address when one is set.
          </Alert>
        </div>
      ) : (
        <div className="mb-4">
          <Alert tone="warning">No sending address is configured on the server (EMAIL_FROM), so no sender can be added yet.</Alert>
        </div>
      )}
      <SendersEditor senders={senders} domain={domain} />
    </>
  );
}
