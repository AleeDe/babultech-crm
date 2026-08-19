import { createCampaign, getCreateFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Input, Select, Textarea, Alert } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";

export default async function NewCampaignPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="creating campaigns" />;

  const { campaignTypes, users } = await getCreateFormOptions();


  return (
    <>
      <PageHeader
        title="New campaign"
        description="A marketing push you want to attribute leads and revenue to."
      />

      {campaignTypes.length === 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            There are no campaign types yet. An administrator can add them under Settings.
          </Alert>
        </div>
      )}

      <div className="max-w-2xl">
        <RecordForm action={createCampaign} redirectTo="/campaigns" submitLabel="Create campaign">
              <FormField label="Name" name="name" required
            help="What this campaign is called. Use something you will recognise in a report a year from now.">
                <Input name="name" required placeholder="Food Tech Expo 2026" />
              </FormField>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Type" name="campaignTypeId" required
            help="The kind of activity — email, event, advertising, webinar.">
                  <Select name="campaignTypeId" required defaultValue="">
                    <option value="" disabled>Choose a type…</option>
                    {campaignTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                </FormField>

                <FormField label="Owner" name="ownerUserId" required
            help="Who is running it.">
                  <Select name="ownerUserId" required defaultValue={me.id}>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </Select>
                </FormField>

                <FormField label="Status" name="status"
            help="Where the campaign is up to. Only active campaigns appear when attributing new leads.">
                  <Select name="status" defaultValue="PLANNED">
                    <option value="PLANNED">Planned</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PAUSED">Paused</option>
                    <option value="COMPLETED">Completed</option>
                  </Select>
                </FormField>

                <FormField label="Budget" name="budgetAmount"
            help="What you have committed to spend. Compared against what the campaign returned.">
                  <Input name="budgetAmount" type="number" step="0.01" min="0" placeholder="850000" />
                </FormField>

                <FormField label="Starts" name="startDate"
            help="When the campaign begins.">
                  <Input name="startDate" type="date" />
                </FormField>

                <FormField label="Ends" name="endDate"
            help="When it finishes.">
                  <Input name="endDate" type="date" />
                </FormField>

                <FormField
                  label="Expected leads"
                  name="expectedLeads"
                  hint="Used to measure the campaign afterwards."
            help="How many leads you expect. The benchmark you judge the result against."
                 
                >
                  <Input name="expectedLeads" type="number" min="0" placeholder="40" />
                </FormField>

                <FormField label="Expected revenue" name="expectedRevenue"
            help="The revenue you expect it to generate.">
                  <Input name="expectedRevenue" type="number" step="0.01" min="0" placeholder="6000000" />
                </FormField>
              </div>

              <FormField label="Description" name="description"
            help="What the campaign is doing and who it targets.">
                <Textarea name="description" rows={3} placeholder="What the campaign is and who it targets." />
              </FormField>
        </RecordForm>
      </div>
    </>
  );
}
