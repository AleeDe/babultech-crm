import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticle } from "@/server/support-portal";
import { PageHeader, Badge, Button } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getArticle(id);
  if (!article) notFound();

  return (
    <>
      <PageHeader
        backTo="/support/knowledge"
        backLabel="Back to help articles"
        title={article.title}
        description={article.publishedAt ? `Updated ${formatDate(article.publishedAt)}` : undefined}
      >
        {(article.tags ?? []).slice(0, 4).map((tag) => (
          <Badge key={tag} tone="neutral">{tag}</Badge>
        ))}
      </PageHeader>

      <article className="max-w-3xl space-y-4">
        {article.summary && <p className="text-muted-foreground">{article.summary}</p>}
        {/* Plain text rather than rendered HTML: an article is written
            internally, but rendering it as markup here would make the customer
            portal the one place where internal content becomes executable. */}
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{article.content}</div>
      </article>

      <div className="mt-8 rounded-lg border border-dashed p-5">
        <p className="text-sm font-medium">Did this not answer your question?</p>
        <p className="mt-1 text-sm text-muted-foreground">Raise a ticket and someone will help.</p>
        <Button asChild className="mt-3"><Link href="/support/new">Raise a ticket</Link></Button>
      </div>
    </>
  );
}
