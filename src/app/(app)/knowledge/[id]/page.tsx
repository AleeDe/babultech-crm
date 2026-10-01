import { notFound } from "next/navigation";
import { requireUser, canAny, PERMISSIONS } from "@/lib/authz";
import { getKnowledgeArticle, canWriteKnowledge, listArticleCategories } from "@/server/knowledge";
import { PageHeader, Forbidden } from "@/components/ui";
import { ArticleEditor } from "../article-editor";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!canAny(me, PERMISSIONS.CASE_READ, PERMISSIONS.ADMIN)) return <Forbidden what="the knowledge base" />;
  const { id } = await params;
  const [article, canWrite, categories] = await Promise.all([getKnowledgeArticle(id), canWriteKnowledge(), listArticleCategories()]);
  if (!article) notFound();
  return (
    <>
      <PageHeader
        backTo="/knowledge"
        backLabel="Back to the knowledge base"
        title={article.title}
        description={`${article.articleNumber}${article.authorName ? ` · by ${article.authorName}` : ""}`}
      />
      <ArticleEditor article={article} categories={categories} canWrite={canWrite} />
    </>
  );
}
