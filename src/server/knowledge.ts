"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { authorize, requireUser, can, canAny, PERMISSIONS } from "@/lib/authz";
import { createRecord, updateRecord } from "@/lib/db";
import { SEQUENCES } from "@/lib/numbering";
import type { ActionResult } from "./partners";

/**
 * Writing the knowledge base. Support staff draft, publish and archive
 * articles; an article published for the customer portal shows on the
 * portal's Help articles at once.
 */

export interface Article {
  id: string;
  articleNumber: string;
  title: string;
  summary: string | null;
  content: string;
  status: string;
  visibility: string;
  categoryId: string | null;
  tags: string[];
  publishedAt: string | null;
  updatedAt: string;
  authorName: string | null;
}

/** Who may write articles: people who work cases, and administrators. */
async function canWrite(): Promise<boolean> {
  const me = await requireUser();
  return canAny(me, PERMISSIONS.CASE_WRITE, PERMISSIONS.ADMIN);
}

export async function listKnowledge(filters: { search?: string; status?: string } = {}): Promise<Article[]> {
  await requireUser();
  const db = await supabaseServer();
  let query = db
    .from("knowledge_article")
    .select("id, articleNumber, title, summary, content, status, visibility, categoryId, tags, publishedAt, updatedAt, author:app_user!knowledge_article_authorUserId_fkey ( fullName )")
    .is("deletedAt", null)
    .order("updatedAt", { ascending: false })
    .limit(300);
  if (filters.status) query = query.eq("status", filters.status);
  const term = filters.search?.replace(/[,()%]/g, "").trim();
  if (term) query = query.or(`title.ilike.%${term}%,summary.ilike.%${term}%,articleNumber.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load articles: ${error.message}`);
  return (data ?? []).map((a) => ({
    ...(a as unknown as Article),
    tags: (a.tags as string[] | null) ?? [],
    authorName: ((Array.isArray(a.author) ? a.author[0] : a.author) as { fullName?: string } | null)?.fullName ?? null,
  }));
}

export async function getKnowledgeArticle(id: string): Promise<Article | null> {
  const list = await listKnowledgeById(id);
  return list;
}

async function listKnowledgeById(id: string): Promise<Article | null> {
  await requireUser();
  const db = await supabaseServer();
  const { data } = await db
    .from("knowledge_article")
    .select("id, articleNumber, title, summary, content, status, visibility, categoryId, tags, publishedAt, updatedAt, author:app_user!knowledge_article_authorUserId_fkey ( fullName )")
    .eq("id", id)
    .is("deletedAt", null)
    .maybeSingle();
  if (!data) return null;
  return {
    ...(data as unknown as Article),
    tags: (data.tags as string[] | null) ?? [],
    authorName: ((Array.isArray(data.author) ? data.author[0] : data.author) as { fullName?: string } | null)?.fullName ?? null,
  };
}

const articleSchema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(3, "Give the article a title.").max(300),
  summary: z.string().trim().max(1000).optional().or(z.literal("")),
  content: z.string().trim().min(1, "Write the article.").max(100_000),
  status: z.enum(["DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"]),
  visibility: z.enum(["INTERNAL", "CUSTOMER_PORTAL"]),
  categoryId: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
});

export async function saveKnowledgeArticle(input: z.infer<typeof articleSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!(await canWrite())) return { ok: false, error: "Only people who work support cases can write articles." };
  const parsed = articleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the article." };
  const d = parsed.data;
  const now = new Date().toISOString();
  const row = {
    title: d.title,
    summary: d.summary || null,
    content: d.content,
    status: d.status,
    visibility: d.visibility,
    categoryId: d.categoryId,
    tags: d.tags,
    updatedAt: now,
  };

  try {
    if (!d.id) {
      const created = await createRecord<{ id: string }>(
        "knowledge_article",
        { ...row, authorUserId: auth.user.id, versionNumber: 1, viewCount: 0, helpfulCount: 0, publishedAt: d.status === "PUBLISHED" ? now : null },
        { field: "articleNumber", sequence: SEQUENCES.ARTICLE },
      );
      revalidatePath("/knowledge");
      revalidatePath("/support/knowledge");
      return { ok: true, data: { id: created.id } };
    }
    const db = await supabaseServer();
    const { data: before } = await db.from("knowledge_article").select("status, publishedAt, versionNumber").eq("id", d.id).maybeSingle();
    if (!before) return { ok: false, error: "That article could not be found." };
    await updateRecord(
      "knowledge_article",
      d.id,
      {
        ...row,
        // Publishing stamps the date; a published article that changes is a new version.
        publishedAt: d.status === "PUBLISHED" ? (before.status === "PUBLISHED" ? before.publishedAt : now) : before.publishedAt,
        versionNumber: Number(before.versionNumber ?? 1) + (before.status === "PUBLISHED" ? 1 : 0),
      },
      "KnowledgeArticle",
      auth.user.id,
    );
    revalidatePath("/knowledge");
    revalidatePath(`/knowledge/${d.id}`);
    revalidatePath("/support/knowledge");
    return { ok: true, data: { id: d.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The article could not be saved." };
  }
}

export async function canWriteKnowledge(): Promise<boolean> {
  return canWrite();
}

export async function listArticleCategories(): Promise<{ id: string; name: string }[]> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.CASE_READ) && !can(me, PERMISSIONS.ADMIN)) return [];
  const db = await supabaseServer();
  const { data } = await db.from("case_category").select("id, name").order("name");
  return (data ?? []) as { id: string; name: string }[];
}
