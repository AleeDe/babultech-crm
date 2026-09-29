import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { listWebForms } from "@/server/web-forms";
import { NewWebFormButton } from "./new-web-form-button";

/** A campaign's website forms, and a way to add one. */
export async function WebFormsCard({ campaignId, canWrite }: { campaignId: string; canWrite: boolean }) {
  const forms = await listWebForms(campaignId).catch(() => []);
  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Website forms</CardTitle>
        {canWrite && <NewWebFormButton campaignId={campaignId} />}
      </CardHeader>
      <CardContent>
        {forms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            A form on your website that sends sign-ups here as prospects, with where they came from.
          </p>
        ) : (
          <ul className="space-y-2">
            {forms.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0">
                <Link href={`/campaigns/forms/${f.id}`} className="font-medium hover:underline">{f.name}</Link>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{f.submissionCount} submission{f.submissionCount === 1 ? "" : "s"}</span>
                  <Badge tone={f.active ? "success" : "neutral"}>{f.active ? "Live" : "Off"}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
