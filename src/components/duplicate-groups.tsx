import Link from "next/link";
import { GitMerge } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, CardTitle, CardContent, EmptyState, StatTile, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { MERGE_NOUN, type CandidateGroup, type MergeEntity } from "@/lib/record-merge";
import { formatDate } from "@/lib/utils";

/** The groups of likely duplicates, each with a way into the merge screen. */
export function DuplicateGroups({ entity, groups, canMerge }: { entity: MergeEntity; groups: CandidateGroup[]; canMerge: boolean }) {
  const noun = MERGE_NOUN[entity];
  const involved = new Set(groups.flatMap((g) => g.records.map((r) => r.id))).size;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile label="Groups to look at" value={String(groups.length)} tone={groups.length > 0 ? "warning" : "success"} />
        <StatTile label={`${noun.many[0].toUpperCase()}${noun.many.slice(1)} involved`} value={String(involved)} />
      </div>
      {groups.length === 0 ? (
        <Card className="mt-6">
          <div className="py-10">
            <EmptyState title="No duplicates found" description={`No two live ${noun.many} look like the same one.`} />
          </div>
        </Card>
      ) : (
        <>
          <div className="mt-6">
            <Alert tone="info">
              <span className="font-medium">Merging keeps everything.</span> Every deal, case, invoice, note and file on the
              others moves to the record you keep. The others are retired rather than deleted, and the merge is recorded in history.
            </Alert>
          </div>
          <div className="mt-6 space-y-5">
            {groups.map((g) => (
              <Card key={g.records.map((r) => r.id).join("-")}>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>{g.records.length} {noun.many} share {g.matchedOn}</CardTitle>
                  {canMerge && (
                    <Button asChild>
                      <Link href={`${noun.path}/merge?ids=${g.records.map((r) => r.id).join(",")}`}>
                        <GitMerge className="h-4 w-4" /> Merge these
                      </Link>
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="px-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH>{entity === "contact" ? "Contact" : "Account"}</TH>
                        <TH priority="secondary">Details</TH>
                        <TH>Created</TH>
                        <TH className="text-right">Fields filled</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {g.records.map((r) => (
                        <TR key={r.id}>
                          <TD>
                            <Link href={`${noun.path}/${r.id}`} className="text-sm font-medium hover:underline">{r.title}</Link>
                            {r.keepOnly && <Badge tone="info" className="ml-2">{r.keepOnly}</Badge>}
                          </TD>
                          <TD priority="secondary" className="text-sm text-muted-foreground">{r.subtitle || "—"}</TD>
                          <TD className="text-sm">{formatDate(r.createdAt)}</TD>
                          <TD className="text-right"><Badge tone="neutral">{r.completeness}</Badge></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
