import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, DetailRow } from "@/components/ui";
import { getDealAttribution } from "@/server/marketing";
import { ATTRIBUTION_MODELS } from "@/lib/marketing";

/**
 * Which campaigns earned this deal. The primary campaign is the deal's own
 * campaign field, changed on Edit; the other three are fixed when the lead is
 * converted.
 */
export async function DealAttribution({ opportunityId }: { opportunityId: string }) {
  const a = await getDealAttribution(opportunityId).catch(() => null);
  if (!a) return null;
  const values = { PRIMARY: a.primary, FIRST: a.first, LEAD_CREATION: a.leadCreation, LATEST: a.latest };
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Campaign attribution</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {ATTRIBUTION_MODELS.map((m) => {
          const c = values[m.value];
          return (
            <DetailRow key={m.value} label={m.label}>
              {c ? <Link href={`/campaigns/${c.id}`} className="text-primary hover:underline">{c.name}</Link> : "—"}
              <p className="text-xs text-muted-foreground">{m.help}</p>
            </DetailRow>
          );
        })}
      </CardContent>
    </Card>
  );
}
