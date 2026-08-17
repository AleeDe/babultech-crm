import { createActivity, getCreateFormOptions } from "@/server/crm";
import { requireUser } from "@/lib/authz";
import { PageHeader, Input, Select, Textarea } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";
import { ActivityTypeFields } from "../activity-type-fields";

/**
 * Logging a touch.
 *
 * Everything can arrive prefilled through the query string, which is how the
 * "Log a touch" button on a lead opened from a campaign carries its context
 * across: the lead it concerns and the campaign to attribute it to. Retyping
 * either one is the sort of step a rep making fifty calls a day will skip, and
 * a skipped campaign is a hole in the attribution report.
 */
export default async function NewActivityPage({
  searchParams,
}: {
  searchParams: Promise<{
    campaignId?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    subject?: string;
    activityType?: string;
  }>;
}) {
  // No permission gate: everyone records their own calls, meetings and tasks.
  const me = await requireUser();
  const [{ users, contacts, campaigns }, params] = await Promise.all([
    getCreateFormOptions(),
    searchParams,
  ]);

  // A campaign that is not in the selectable list (a COMPLETED one, say)
  // must not be silently swapped for "None" — that would attribute the touch
  // to nothing without saying so.
  const prefilledCampaign = campaigns.some((c) => c.id === params.campaignId)
    ? params.campaignId
    : "";

  return (
    <>
      <PageHeader
        title="Log a touch"
        description="A call, meeting, message, task or reminder — and who it belongs to."
      />

      <div className="max-w-2xl">
        <RecordForm action={createActivity} redirectTo="/activities" submitLabel="Save touch">
          {/* Carries the record this touch concerns without asking the rep to
              restate it. Hidden rather than shown read-only: there is nothing
              useful to do with it on this screen. */}
          {params.relatedEntityType && params.relatedEntityId && (
            <>
              <input type="hidden" name="relatedEntityType" value={params.relatedEntityType} />
              <input type="hidden" name="relatedEntityId" value={params.relatedEntityId} />
            </>
          )}

          <ActivityTypeFields
            defaultType={params.activityType ?? "TASK"}
            defaultChannel=""
          />

          <FormField label="Subject" name="subject" required>
            <Input
              name="subject"
              required
              defaultValue={params.subject ?? ""}
              placeholder="Follow up on the renewal quote"
            />
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
              label="Campaign"
              name="campaignId"
              hint={
                prefilledCampaign
                  ? "Carried over from the campaign you came from."
                  : "Attributes this touch to a campaign's results."
              }
            >
              <Select name="campaignId" defaultValue={prefilledCampaign}>
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Contact" name="contactId" hint="Who it concerns, if anyone.">
              <Select name="contactId" defaultValue="">
                <option value="">None</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
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
