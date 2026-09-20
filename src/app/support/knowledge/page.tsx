import Link from "next/link";
import { BookOpen } from "lucide-react";
import { listArticles } from "@/server/support-portal";
import { PageHeader, Input, Card, CardContent } from "@/components/ui";
import { formatDate } from "@/lib/utils";

/** The articles we have published for customers. */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const articles = await listArticles(q);

  return (
    <>
      <PageHeader
        title="Help articles"
        description="How-tos and answers to the questions we are asked most. Worth a look before raising a ticket."
      />

      <form className="mb-5 max-w-md" action="/support/knowledge">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search the help articles…" aria-label="Search articles" />
      </form>

      {articles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">{q ? `Nothing matches "${q}"` : "No articles yet"}</p>
            <p className="text-sm text-muted-foreground">
              {q ? "Try a different word, or raise a ticket and we will help." : "We are still writing these. Raise a ticket and we will help directly."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {articles.map((article) => (
            <li key={article.id}>
              <Link
                href={`/support/knowledge/${article.id}`}
                className="block h-full rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <p className="font-medium">{article.title}</p>
                {article.summary && (
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{article.summary}</p>
                )}
                {article.publishedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">Updated {formatDate(article.publishedAt)}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
