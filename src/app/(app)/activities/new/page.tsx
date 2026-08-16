import { createActivity, getCreateFormOptions } from "@/server/crm";
import { requireUser } from "@/lib/authz";
import { PageHeader, Input, Select, Textarea } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";

export default async function NewActivityPage() {
  // No permission gate: everyone records their own calls, meetings and tasks.
  const me = await requireUser();
  const { users, contacts } = await getCreateFormOptions();


  return (
    <>
      <PageHeader
        title="New activity"
        description="A call, meeting, task or reminder — and who it belongs to."
      />

      <div className="max-w-2xl">
        <RecordForm action={createActivity} redirectTo="/activities" submitLabel="Create activity">
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Type" name="activityType" required>
                  <Select name="activityType" required defaultValue="TASK">
                    <option value="TASK">Task</option>
                    <option value="CALL">Call</option>
                    <option value="MEETING">Meeting</option>
                    <option value="REMINDER">Reminder</option>
                  </Select>
                </FormField>

                <FormField label="Priority" name="priority">
                  <Select name="priority" defaultValue="MEDIUM">
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </Select>
                </FormField>
              </div>

              <FormField label="Subject" name="subject" required>
                <Input name="subject" required placeholder="Follow up on the renewal quote" />
              </FormField>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Owner" name="ownerUserId" required>
                  <Select name="ownerUserId" required defaultValue={me.id}>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </Select>
                </FormField>

                <FormField
                  label="Contact"
                  name="contactId"
                  hint="Who it concerns, if anyone."
                 
                >
                  <Select name="contactId" defaultValue="">
                    <option value="">None</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName}
                      </option>
                    ))}
                  </Select>
                </FormField>

                <FormField label="Starts" name="startAt">
                  <Input name="startAt" type="datetime-local" />
                </FormField>

                <FormField label="Due" name="dueAt">
                  <Input name="dueAt" type="datetime-local" />
                </FormField>
              </div>

              <FormField label="Location" name="location">
                <Input name="location" placeholder="Online — Teams, or an address" />
              </FormField>

              <FormField label="Notes" name="description">
                <Textarea name="description" rows={3} placeholder="Anything worth remembering." />
              </FormField>
        </RecordForm>
      </div>
    </>
  );
}
