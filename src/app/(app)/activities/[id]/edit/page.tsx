import { notFound } from "next/navigation";
import { getActivity, updateActivity, getCreateFormOptions } from "@/server/crm";
import { requireUser } from "@/lib/authz";
import { PageHeader, Input, Select, Textarea, Forbidden } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";

/** datetime-local wants "YYYY-MM-DDTHH:mm", not a full ISO string. */
const dateTimeInput = (v: unknown) => (v ? String(v).slice(0, 16) : "");

export default async function EditActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();

  const { id } = await params;
  const [activity, { users, contacts }] = await Promise.all([
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
          <div className="grid gap-5 sm:grid-cols-3">
            <FormField label="Type" name="activityType" required>
              <Select name="activityType" required defaultValue={activity.activityType}>
                <option value="TASK">Task</option>
                <option value="CALL">Call</option>
                <option value="MEETING">Meeting</option>
                <option value="REMINDER">Reminder</option>
              </Select>
            </FormField>

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
