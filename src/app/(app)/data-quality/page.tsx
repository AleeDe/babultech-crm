import Link from "next/link";
import { requireUser } from "@/lib/authz";
import { getDataQuality } from "@/server/data-quality";
import { DATA_QUALITY_RULES } from "@/lib/data-quality";
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Button, StatTile } from "@/components/ui";
import { formatDate } from "@/lib/utils";

/**
 * What is missing or neglected across the records you can see: one card per
 * rule, the oldest records first, each a link to fix it.
 */
export default async function DataQualityPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  await requireUser();
  const { mine } = await searchParams;
  const onlyMine = mine === "1";
  const results = await getDataQuality({ mine: onlyMine });
  const byRule = new Map(results.map((r) => [r.rule, r]));
  const total = results.reduce((s, r) => s + r.count, 0);
  const rulesHit = results.filter((r) => r.count > 0).length;

  return (
    <>
      <PageHeader
        title="Data quality"
        description="Records missing something that matters, or left alone too long. Only records you can see are counted."
      >
        <Button asChild variant={onlyMine ? "default" : "outline"}>
          <Link href={onlyMine ? "/data-quality" : "/data-quality?mine=1"}>{onlyMine ? "Showing yours" : "Only mine"}</Link>
        </Button>
        <Button asChild variant="outline"><Link href="/accounts/duplicates">Duplicate accounts</Link></Button>
        <Button asChild variant="outline"><Link href="/contacts/duplicates">Duplicate contacts</Link></Button>
        <Button asChild variant="outline"><Link href="/leads/duplicates">Duplicate leads</Link></Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Records to fix" value={String(total)} tone={total > 0 ? "warning" : "success"} />
        <StatTile label="Rules with something to fix" value={`${rulesHit} of ${DATA_QUALITY_RULES.length}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {DATA_QUALITY_RULES.map((rule) => {
          const result = byRule.get(rule.key);
          const count = result?.count ?? 0;
          return (
            <Card key={rule.key} data-rule={rule.key}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle>{rule.title}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{rule.why} {rule.fix}</p>
                </div>
                <Badge tone={count > 0 ? "warning" : "success"}>{count}</Badge>
              </CardHeader>
              <CardContent className="px-0">
                {count === 0 ? (
                  <p className="px-5 pb-2 text-sm text-muted-foreground">Nothing to fix.</p>
                ) : (
                  <ul className="divide-y">
                    {result!.records.map((r) => (
                      <li key={r.href} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                        <Link href={r.href} className="min-w-0 truncate font-medium hover:underline">{r.label}</Link>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {r.ownerName ? `${r.ownerName} · ` : ""}since {formatDate(r.since)}
                        </span>
                      </li>
                    ))}
                    {count > result!.records.length && (
                      <li className="px-5 py-2 text-xs text-muted-foreground">and {count - result!.records.length} more - the oldest are shown first.</li>
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
