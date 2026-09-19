import { createActivity, getCreateFormOptions } from "@/server/crm";
import { requireUser } from "@/lib/authz";
import { PageHeader, Input, Select, Textarea } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";
import { PicklistOptions } from "@/components/picklist";
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
        backTo="/activities"
        backLabel="Back to activities"
        title="Log a touch"
        description="A call, meeting, message, task or reminder - and who it belongs to."
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

          <FormField label="Subject" name="subject" required
            help="What this is, in one line. It is what shows in every list and reminder.">
            <Input
              name="subject"
              required
              defaultValue={params.subject ?? ""}
              placeholder="Follow up on the renewal quote"
            />
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Owner" name="ownerUserId" required
            help="Whose task this is. It appears in their work list.">
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
            help="The campaign this activity belongs to, if any."
            >
              <Select name="campaignId" defaultValue={prefilledCampaign}>
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Contact" name="contactId" hint="Who it concerns, if anyone."
            help="The person it concerns, if it involves someone outside.">
              <Select name="contactId" defaultValue="">
                <option value="">None</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Priority" name="priority"
            help="How urgent it is, which decides where it sorts in the owner's list.">
              <Select name="priority" defaultValue="MEDIUM">
                <PicklistOptions list="priority" fallback={["LOW", "MEDIUM", "HIGH", "CRITICAL"]} within={["LOW", "MEDIUM", "HIGH", "CRITICAL"]} current={"MEDIUM"} />
              </Select>
            </FormField>

            <FormField label="Starts" name="startAt"
            help="When it begins. For a meeting or call, the actual time.">
              <Input name="startAt" type="datetime-local" />
            </FormField>

            <FormField label="Due" name="dueAt"
            help="When it has to be done. Overdue items are flagged on the work list.">
              <Input name="dueAt" type="datetime-local" />
            </FormField>
          </div>

          <FormField label="Location" name="location"
            help="Where it happens - an address, or a meeting link.">
            <Input name="location" placeholder="Online - Teams, or an address" />
          </FormField>

          <FormField label="Notes" name="description"
            help="Anything needed to prepare, or what came out of it afterwards.">
            <Textarea name="description" rows={3} placeholder="Anything worth remembering." />
          </FormField>
        </RecordForm>
      </div>
    </>
  );
}
