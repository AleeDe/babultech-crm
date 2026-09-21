"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { PicklistSelect } from "@/components/picklist-select";
import { saveCampaignActivity, type CampaignActivity } from "@/server/campaign-activities";

/**
 * One activity: what is being run, and for an email, what it says.
 *
 * The email fields only appear for an email. Showing a subject line on a round
 * of phone calls invites somebody to fill it in and wonder later why nothing
 * used it.
 */
export function ActivityForm({
  campaigns,
  defaults,
  lockedCampaignId,
}: {
  campaigns: { id: string; name: string }[];
  defaults?: CampaignActivity | null;
  lockedCampaignId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [type, setType] = useState(defaults?.activityType ?? "EMAIL");

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? "");
    setError(null);
    setFieldErrors({});

    start(async () => {
      const result = await saveCampaignActivity({
        id: defaults?.id ?? null,
        campaignId: lockedCampaignId ?? text("campaignId"),
        name: text("name"),
        activityType: type,
        scheduledAt: text("scheduledAt"),
        subject: text("subject"),
        bodyText: text("bodyText"),
        fromName: text("fromName"),
        replyTo: text("replyTo"),
        description: text("description"),
      });

      if (result.ok) {
        router.push(`/campaigns/activities/${result.data.id}`);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>What are you running?</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {!lockedCampaignId && (
            <Field label="Campaign" required error={fieldErrors.campaignId?.[0]}>
              <Select id="campaignId" name="campaignId" required defaultValue={defaults?.campaignId ?? ""}>
                <option value="">Choose a campaign…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Name" required error={fieldErrors.name?.[0]} help="What you would call this run of outreach.">
            <Input id="name" name="name" required minLength={2} maxLength={200} defaultValue={defaults?.name ?? ""} placeholder="Q4 introduction email" />
          </Field>
          <Field label="How you are reaching them" required help="Decides what is recorded against each person afterwards.">
            <PicklistSelect
              list="campaign_activity_type"
              name="activityType"
              defaultValue={type}
              onValueChange={setType}
              emptyLabel={null}
              addLabel="Add a channel"
            />
          </Field>
          <Field label="When" help="When it is due to go out, or when the webinar is.">
            <Input id="scheduledAt" name="scheduledAt" type="datetime-local" defaultValue={defaults?.scheduledAt?.slice(0, 16) ?? ""} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes" help="Anything whoever runs this needs to know.">
              <Textarea id="description" name="description" rows={2} maxLength={4000} defaultValue={defaults?.description ?? ""} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {type === "EMAIL" && (
        <Card>
          <CardHeader>
            <CardTitle>The email</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Use <code>{"{{firstName}}"}</code>, <code>{"{{lastName}}"}</code> or{" "}
              <code>{"{{companyName}}"}</code> and each person gets their own. An unsubscribe link
              is added to every message automatically.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Subject" required error={fieldErrors.subject?.[0]}>
                <Input id="subject" name="subject" maxLength={300} defaultValue={defaults?.subject ?? ""} placeholder="A quick introduction, {{firstName}}" />
              </Field>
            </div>
            <Field label="From name" help="Shown as the sender. The address itself is ours.">
              <Input id="fromName" name="fromName" maxLength={120} defaultValue={defaults?.fromName ?? ""} placeholder="BabulTech" />
            </Field>
            <Field label="Replies go to" error={fieldErrors.replyTo?.[0]} help="Where an answer lands. Leave blank to use the sending address.">
              <Input id="replyTo" name="replyTo" type="email" maxLength={255} defaultValue={defaults?.replyTo ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Message" required help="Plain text. Blank lines become paragraphs.">
                <Textarea id="bodyText" name="bodyText" rows={10} maxLength={50000} defaultValue={defaults?.bodyText ?? ""} />
              </Field>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : defaults ? "Save activity" : "Create activity"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
