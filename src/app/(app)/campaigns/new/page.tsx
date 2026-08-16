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
              <FormField label="Name" name="name" required>
                <Input name="name" required placeholder="Food Tech Expo 2026" />
              </FormField>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Type" name="campaignTypeId" required>
                  <Select name="campaignTypeId" required defaultValue="">
                    <option value="" disabled>Choose a type…</option>
                    {campaignTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                </FormField>

                <FormField label="Owner" name="ownerUserId" required>
                  <Select name="ownerUserId" required defaultValue={me.id}>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </Select>
                </FormField>

                <FormField label="Status" name="status">
                  <Select name="status" defaultValue="PLANNED">
                    <option value="PLANNED">Planned</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PAUSED">Paused</option>
                    <option value="COMPLETED">Completed</option>
                  </Select>
                </FormField>

                <FormField label="Budget" name="budgetAmount">
                  <Input name="budgetAmount" type="number" step="0.01" min="0" placeholder="850000" />
                </FormField>

                <FormField label="Starts" name="startDate">
                  <Input name="startDate" type="date" />
                </FormField>

                <FormField label="Ends" name="endDate">
                  <Input name="endDate" type="date" />
                </FormField>

                <FormField
                  label="Expected leads"
                  name="expectedLeads"
                  hint="Used to measure the campaign afterwards."
                 
                >
                  <Input name="expectedLeads" type="number" min="0" placeholder="40" />
                </FormField>

                <FormField label="Expected revenue" name="expectedRevenue">
                  <Input name="expectedRevenue" type="number" step="0.01" min="0" placeholder="6000000" />
                </FormField>
              </div>

              <FormField label="Description" name="description">
                <Textarea name="description" rows={3} placeholder="What the campaign is and who it targets." />
              </FormField>
        </RecordForm>
      </div>
    </>
  );
}
