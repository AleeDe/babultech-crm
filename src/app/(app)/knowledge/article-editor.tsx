"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { saveKnowledgeArticle, type Article } from "@/server/knowledge";

/**
 * Writing an article. Plain text with blank lines between paragraphs - what the
 * portal shows is exactly what is typed, so nothing in an article can run as
 * code on a customer's screen.
 */
export function ArticleEditor({
  article,
  categories,
  canWrite,
}: {
  article: Article | null;
  categories: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(article?.title ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [content, setContent] = useState(article?.content ?? "");
  const [status, setStatus] = useState(article?.status ?? "DRAFT");
  const [visibility, setVisibility] = useState(article?.visibility ?? "CUSTOMER_PORTAL");
  const [categoryId, setCategoryId] = useState(article?.categoryId ?? "");
  const [tags, setTags] = useState((article?.tags ?? []).join(", "));
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = (nextStatus?: string) =>
    start(async () => {
      setMessage(null);
      const s = nextStatus ?? status;
      const result = await saveKnowledgeArticle({
        id: article?.id ?? null,
        title,
        summary,
        content,
        status: s as never,
        visibility: visibility as never,
        categoryId: categoryId || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      if (!result.ok) return setMessage({ tone: "danger", text: result.error });
      setStatus(s);
      setMessage({
        tone: "success",
        text: s === "PUBLISHED" && visibility === "CUSTOMER_PORTAL" ? "Published. Customers can read it now." : "Saved.",
      });
      if (!article) router.push(`/knowledge/${result.data.id}`);
    });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{article ? article.articleNumber : "New article"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <Field label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} disabled={!canWrite} placeholder="How to reset your password" />
          </Field>
          <Field label="Summary" help="One or two lines, shown in the list and search results.">
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} disabled={!canWrite} />
          </Field>
          <Field label="Article" required help="Plain text. Leave a blank line between paragraphs.">
            <Textarea rows={18} value={content} onChange={(e) => setContent(e.target.value)} disabled={!canWrite} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Publishing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!canWrite}>
              <option value="DRAFT">Draft</option>
              <option value="REVIEW">In review</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
          <Field label="Shown to">
            <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} disabled={!canWrite}>
              <option value="CUSTOMER_PORTAL">Customers, in the support portal</option>
              <option value="INTERNAL">Our team only</option>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!canWrite}>
              <option value="">None</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Tags" help="Separated by commas.">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} disabled={!canWrite} placeholder="login, password" />
          </Field>
          {canWrite && (
            <div className="flex flex-col gap-2">
              <Button onClick={() => save()} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
              {status !== "PUBLISHED" && (
                <Button variant="outline" onClick={() => save("PUBLISHED")} disabled={pending}>Save and publish</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
