import { notFound } from "next/navigation";
import { getCampaign, updateCampaign, getCreateFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Input, Select, Textarea } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";

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
      <PageHeader title={`Edit ${campaign.name}`} description={campaign.campaignNumber} />

      <div className="max-w-2xl">
        <RecordForm action={save} redirectTo={`/campaigns/${id}`} submitLabel="Save changes">
          <FormField label="Name" name="name" required>
            <Input name="name" required defaultValue={campaign.name} />
          </FormField>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Type" name="campaignTypeId" required>
              <Select name="campaignTypeId" required defaultValue={campaign.campaignTypeId}>
                {campaignTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Owner" name="ownerUserId" required>
              <Select name="ownerUserId" required defaultValue={campaign.ownerUserId}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Status" name="status">
              <Select name="status" defaultValue={campaign.status}>
                <option value="PLANNED">Planned</option>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="COMPLETED">Completed</option>
              </Select>
            </FormField>

            <FormField label="Budget" name="budgetAmount">
              <Input
                name="budgetAmount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={campaign.budgetAmount ?? ""}
              />
            </FormField>

            <FormField label="Starts" name="startDate">
              <Input name="startDate" type="date" defaultValue={dateInput(campaign.startDate)} />
            </FormField>

            <FormField label="Ends" name="endDate">
              <Input name="endDate" type="date" defaultValue={dateInput(campaign.endDate)} />
            </FormField>

            <FormField label="Expected leads" name="expectedLeads">
              <Input name="expectedLeads" type="number" min="0" defaultValue={campaign.expectedLeads ?? ""} />
            </FormField>

            <FormField label="Expected revenue" name="expectedRevenue">
              <Input
                name="expectedRevenue"
                type="number"
                step="0.01"
                min="0"
                defaultValue={campaign.expectedRevenue ?? ""}
              />
            </FormField>
          </div>

          <FormField label="Description" name="description">
            <Textarea name="description" rows={3} defaultValue={campaign.description ?? ""} />
          </FormField>
        </RecordForm>
      </div>
    </>
  );
}
