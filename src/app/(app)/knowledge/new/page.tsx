import { requireUser } from "@/lib/authz";
import { canWriteKnowledge, listArticleCategories } from "@/server/knowledge";
import { PageHeader, Forbidden } from "@/components/ui";
import { ArticleEditor } from "../article-editor";

export default async function NewArticlePage() {
  await requireUser();
  if (!(await canWriteKnowledge())) return <Forbidden what="writing articles" />;
  const categories = await listArticleCategories();
  return (
    <>
      <PageHeader backTo="/knowledge" backLabel="Back to the knowledge base" title="New article" />
      <ArticleEditor article={null} categories={categories} canWrite />
    </>
  );
}
