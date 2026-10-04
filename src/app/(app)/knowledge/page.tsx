import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser, canAny, PERMISSIONS, can } from "@/lib/authz";
import { RowActions } from "@/components/row-actions";
import { RECYCLE_TYPES } from "@/lib/recycle-types";
import { listKnowledge, canWriteKnowledge } from "@/server/knowledge";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState, Button, Forbidden, Input, Select } from "@/components/ui";
import { FilterForm } from "@/components/filter-form";
import { formatDate } from "@/lib/utils";

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning"> = {
  DRAFT: "neutral",
  REVIEW: "info",
  PUBLISHED: "success",
  ARCHIVED: "warning",
};

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ search?: string; status?: string }> }) {
  const me = await requireUser();
  const canDeleteRow = can(me, RECYCLE_TYPES.KnowledgeArticle.permission);
  if (!canAny(me, PERMISSIONS.CASE_READ, PERMISSIONS.ADMIN)) return <Forbidden what="the knowledge base" />;
  const params = await searchParams;
  const [articles, canWrite] = await Promise.all([listKnowledge(params), canWriteKnowledge()]);
  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Help articles. Published ones marked for the customer portal appear on the portal's Help articles straight away; internal ones are for our team."
      >
        {canWrite && (
          <Button asChild>
            <Link href="/knowledge/new"><Plus className="h-4 w-4" /> New article</Link>
          </Button>
        )}
      </PageHeader>
      <Card className="mb-6">
        <FilterForm className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1"><Input name="search" defaultValue={params.search} placeholder="Search title, summary or number…" /></div>
          <Select name="status" defaultValue={params.status ?? ""} className="w-44" aria-label="Status">
            <option value="">Any status</option>
            <option value="DRAFT">Draft</option>
            <option value="REVIEW">In review</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
          <Button type="button" variant="secondary">Filter</Button>
        </FilterForm>
      </Card>
      <Card>
        {articles.length === 0 ? (
          <div className="p-6"><EmptyState title="No articles yet" description="Write up the answers customers ask for most often." /></div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Article</TH>
                <TH>Status</TH>
                <TH priority="secondary">Shown to</TH>
                <TH priority="secondary">Updated</TH>
                <TH><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {articles.map((a) => (
                <TR key={a.id}>
                  <TD className="text-sm">
                    <Link href={`/knowledge/${a.id}`} className="font-medium hover:underline">{a.title}</Link>
                    <p className="text-xs text-muted-foreground">{a.articleNumber}{a.summary ? ` · ${a.summary}` : ""}</p>
                  </TD>
                  <TD><Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status === "REVIEW" ? "In review" : a.status.charAt(0) + a.status.slice(1).toLowerCase()}</Badge></TD>
                  <TD className="text-sm" priority="secondary">{a.visibility === "CUSTOMER_PORTAL" ? "Customers" : "Our team"}</TD>
                  <TD className="text-sm" priority="secondary">{formatDate(a.updatedAt)}</TD>
                  <TD className="text-right">
                    <RowActions type="KnowledgeArticle" id={a.id} name={String(a.title ?? "")} editHref={`/knowledge/${a.id}`} canDelete={canDeleteRow} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
