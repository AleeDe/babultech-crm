import { notFound } from "next/navigation";
import { getActivity, updateActivity, getCreateFormOptions } from "@/server/crm";
import { requireUser } from "@/lib/authz";
import { PageHeader, Input, Select, Textarea, Forbidden } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";
import { ActivityTypeFields } from "../../activity-type-fields";

/** datetime-local wants "YYYY-MM-DDTHH:mm", not a full ISO string. */
const dateTimeInput = (v: unknown) => (v ? String(v).slice(0, 16) : "");

export default async function EditActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();

  const { id } = await params;
  const [activity, { users, contacts, campaigns }] = await Promise.all([
    getActivity(id),
    getCreateFormOptions(),
  ]);
  if (!activity) notFound();

  // Anyone may log an activity, but reassigning or closing someone else's is a
  // different thing — the owner does that.
  if (!activity.isMine) return <Forbidden what="editing another person's activity" />;

  const save = updateActivity.bind(null, id);

  return (
    <>
      <PageHeader title={`Edit ${activity.subject}`} description="Update, complete or reassign it." />

      <div className="max-w-2xl">
        <RecordForm action={save} redirectTo={`/activities/${id}`} submitLabel="Save changes">
          {/* The form submits the whole record, so a field the form does not
              render is saved as NULL. These two carry the record the touch
              concerns and are set only when it was logged from that record —
              without them, editing a touch would quietly detach it. */}
          {activity.relatedEntityType && activity.relatedEntityId && (
            <>
              <input type="hidden" name="relatedEntityType" value={String(activity.relatedEntityType)} />
              <input type="hidden" name="relatedEntityId" value={String(activity.relatedEntityId)} />
            </>
          )}

          <ActivityTypeFields
            defaultType={activity.activityType}
            defaultChannel={activity.channel ? String(activity.channel) : ""}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Status" name="status">
              <Select name="status" defaultValue={activity.status}>
                <option value="OPEN">Open</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            </FormField>

            <FormField label="Priority" name="priority">
              <Select name="priority" defaultValue={activity.priority}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </Select>
            </FormField>
          </div>

          <FormField label="Subject" name="subject" required>
            <Input name="subject" required defaultValue={activity.subject} />
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Owner" name="ownerUserId" required>
              <Select name="ownerUserId" required defaultValue={activity.ownerUserId}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Contact" name="contactId">
              <Select name="contactId" defaultValue={activity.contactId ?? ""}>
                <option value="">None</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Campaign" name="campaignId" hint="Attributes this touch to a campaign's results.">
              <Select name="campaignId" defaultValue={activity.campaignId ? String(activity.campaignId) : ""}>
                <option value="">None</option>
                {/* A COMPLETED campaign is not offered for new attribution but
                    must still appear when it is what the record already says,
                    or saving would silently clear it. */}
                {!campaigns.some((c) => c.id === activity.campaignId) && activity.campaignId && (
                  <option value={String(activity.campaignId)}>(current campaign)</option>
                )}
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Starts" name="startAt">
              <Input name="startAt" type="datetime-local" defaultValue={dateTimeInput(activity.startAt)} />
            </FormField>

            <FormField label="Due" name="dueAt">
              <Input name="dueAt" type="datetime-local" defaultValue={dateTimeInput(activity.dueAt)} />
            </FormField>
          </div>

          <FormField label="Location" name="location">
            <Input name="location" defaultValue={activity.location ?? ""} />
          </FormField>

          <FormField label="Notes" name="description">
            <Textarea name="description" rows={3} defaultValue={activity.description ?? ""} />
          </FormField>

          <FormField label="Outcome" name="outcome" hint="What actually happened. Worth filling in when completing.">
            <Textarea name="outcome" rows={2} defaultValue={activity.outcome ?? ""} />
          </FormField>
        </RecordForm>
      </div>
    </>
  );
}
