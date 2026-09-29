import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getWebForm } from "@/server/web-forms";
import { getAssignableUsers } from "@/server/bulk";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Table, THead, TBody, TR, TH, TD, Forbidden,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { WEB_FORM_FIELDS } from "@/lib/marketing";
import { WebFormEditor } from "./web-form-editor";
import { CopyBlock } from "./copy-block";

const OUTCOME: Record<string, { label: string; tone: "success" | "info" | "neutral" | "warning" | "danger" }> = {
  CREATED: { label: "New prospect", tone: "success" },
  MATCHED_LEAD: { label: "Existing lead", tone: "info" },
  MATCHED_CONTACT: { label: "Existing contact", tone: "info" },
  SPAM: { label: "Spam", tone: "neutral" },
  RATE_LIMITED: { label: "Too many", tone: "warning" },
  INVALID: { label: "Incomplete", tone: "danger" },
};

/** The site's own address, for the embed code: the public one if set. */
async function siteAddress(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : configured ?? "";
}

export default async function WebFormPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="website forms" />;
  const { id } = await params;
  const [found, users, base] = await Promise.all([getWebForm(id), getAssignableUsers(), siteAddress()]);
  if (!found) notFound();
  const { form, submissions } = found;
  const canWrite = can(me, PERMISSIONS.LEAD_WRITE);

  const action = `${base}/api/forms/${form.formKey}`;
  const input = (key: string) => {
    const f = WEB_FORM_FIELDS.find((x) => x.key === key)!;
    const required = form.fields.find((x) => x.key === key)?.required ? " required" : "";
    return f.type === "textarea"
      ? `  <label>${f.label}\n    <textarea name="${key}"${required}></textarea>\n  </label>`
      : `  <label>${f.label}\n    <input name="${key}" type="${f.type}"${required}>\n  </label>`;
  };
  const snippet = [
    `<form data-babultech-form action="${action}" method="post">`,
    ...form.fields.map((f) => input(f.key)),
    `  <!-- Leave this hidden field in place: it catches spam robots. -->`,
    `  <input name="_gotcha" type="text" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">`,
    `  <button type="submit">Send</button>`,
    `</form>`,
    `<script src="${base}/api/forms/script" async></script>`,
  ].join("\n");

  return (
    <>
      <PageHeader
        backTo={form.campaign ? `/campaigns/${form.campaign.id}` : "/campaigns/forms"}
        backLabel={form.campaign ? `Back to ${form.campaign.name}` : "Back to forms"}
        title={form.name}
        description="A form on your website that sends sign-ups here as prospects, with where they came from."
      >
        <Badge tone={form.active ? "success" : "neutral"}>{form.active ? "Live" : "Switched off"}</Badge>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <WebFormEditor form={form} users={users.map((u: { id: string; fullName: string }) => ({ id: u.id, fullName: u.fullName }))} canWrite={canWrite} />

        <Card>
          <CardHeader>
            <CardTitle>Put it on your website</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste this where the form should appear. Style it like the rest of your site; keep the field names and the
              hidden field. The script remembers where each visitor first came from - their UTM tags, landing page and
              referrer - and sends it with the form.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <CopyBlock text={snippet} />
            <p className="text-xs text-muted-foreground">
              Links to your site can carry UTM tags, such as <code>?utm_source=linkedin&amp;utm_medium=social&amp;utm_campaign=launch</code>,
              so each sign-up shows which ad or post brought them.
              {form.allowedOrigins.length === 0 && " Any website can post this form until you list yours on the left."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Latest submissions ({form.submissionCount} in all)</CardTitle>
        </CardHeader>
        {submissions.length === 0 ? (
          <CardContent><p className="text-sm text-muted-foreground">Nothing has come in yet.</p></CardContent>
        ) : (
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Who</TH>
                  <TH>Outcome</TH>
                </TR>
              </THead>
              <TBody>
                {submissions.map((s) => {
                  const o = OUTCOME[s.outcome] ?? { label: s.outcome, tone: "neutral" as const };
                  const href = s.leadId ? `/leads/${s.leadId}` : s.contactId ? `/contacts/${s.contactId}` : null;
                  return (
                    <TR key={s.id}>
                      <TD className="whitespace-nowrap text-sm">{formatDateTime(s.createdAt)}</TD>
                      <TD className="text-sm">{href ? <Link href={href} className="hover:underline">{s.summary ?? "—"}</Link> : s.summary ?? "—"}</TD>
                      <TD><Badge tone={o.tone}>{o.label}</Badge></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </>
  );
}
