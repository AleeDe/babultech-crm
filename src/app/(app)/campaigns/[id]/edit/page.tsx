import { notFound } from "next/navigation";
import { getCampaign, updateCampaign, getCreateFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Input, Select, Textarea } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";
import { DateRange, RangeStart, RangeEnd } from "@/components/date-range-fields";

const dateInput = (v: unknown) => (v ? String(v).slice(0, 10) : "");

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="editing campaigns" />;

  const { id } = await params;
  const [campaign, { campaignTypes, users }] = await Promise.all([
    getCampaign(id),
    getCreateFormOptions(),
  ]);
  if (!campaign) notFound();

  const save = updateCampaign.bind(null, id);

  return (
    <>
      <PageHeader
        backTo={`/campaigns/${id}`}
        backLabel="Back to the campaign"
        title={`Edit ${campaign.name}`} description={campaign.campaignNumber} />

      <div className="max-w-2xl">
        <RecordForm action={save} redirectTo={`/campaigns/${id}`} submitLabel="Save changes">
          <FormField label="Name" name="name" required
            help="What this campaign is called. Use something you will recognise in a report a year from now.">
            <Input name="name" required defaultValue={campaign.name} />
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Type" name="campaignTypeId" required
            help="The kind of activity - email, event, advertising, webinar.">
              <Select name="campaignTypeId" required defaultValue={campaign.campaignTypeId}>
                {campaignTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Owner" name="ownerUserId" required
            help="Who is running it.">
              <Select name="ownerUserId" required defaultValue={campaign.ownerUserId}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Status" name="status"
            help="Where the campaign is up to. Only active campaigns appear when attributing new leads.">
              <Select name="status" defaultValue={campaign.status}>
                <option value="PLANNED">Planned</option>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="COMPLETED">Completed</option>
              </Select>
            </FormField>

            <FormField label="Budget" name="budgetAmount"
            help="What you have committed to spend. Compared against what the campaign returned.">
              <Input
                name="budgetAmount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={campaign.budgetAmount ?? ""}
              />
            </FormField>

            <DateRange
              startDefault={dateInput(campaign.startDate)}
              endDefault={dateInput(campaign.endDate)}
            >
              <FormField label="Starts" name="startDate"
              help="When the campaign begins.">
                <RangeStart name="startDate" />
              </FormField>

              <FormField label="Ends" name="endDate"
              help="When it finishes. Cannot be before the start date.">
                <RangeEnd name="endDate" />
              </FormField>
            </DateRange>

            <FormField label="Expected leads" name="expectedLeads"
            help="How many leads you expect. The benchmark you judge the result against.">
              <Input name="expectedLeads" type="number" min="0" defaultValue={campaign.expectedLeads ?? ""} />
            </FormField>

            <FormField label="Expected revenue" name="expectedRevenue"
            help="The revenue you expect it to generate.">
              <Input
                name="expectedRevenue"
                type="number"
                step="0.01"
                min="0"
                defaultValue={campaign.expectedRevenue ?? ""}
              />
            </FormField>
          </div>

          <FormField label="Description" name="description"
            help="What the campaign is doing and who it targets.">
            <Textarea name="description" rows={3} defaultValue={campaign.description ?? ""} />
          </FormField>
        </RecordForm>
      </div>
    </>
  );
}
