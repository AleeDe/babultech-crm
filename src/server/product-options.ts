"use server";

import { authorize, requirePermission, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { optionKey, similarOption, type ProductOptionKind } from "@/lib/product-options";

export async function getProductOptions() {
  await requirePermission(PERMISSIONS.OPPORTUNITY_WRITE);
  const db = await supabaseServer();
  const { data, error } = await db.from("product_option").select("kind, name").order("name");
  if (error) throw new Error(`Could not load categories and units: ${error.message}`);
  return {
    categories: (data ?? []).filter((r) => r.kind === "category").map((r) => String(r.name)),
    units: (data ?? []).filter((r) => r.kind === "unit").map((r) => String(r.name)),
  };
}

export async function createProductOption(kind: ProductOptionKind, input: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!auth.ok) return auth;
  if ((kind !== "category" && kind !== "unit") || typeof input !== "string") return { ok: false, error: "Invalid option." };
  const name = input.trim().replace(/\s+/g, " ");
  if (!optionKey(name) || name.length > (kind === "unit" ? 30 : 100)) return { ok: false, error: "Enter a valid, shorter name." };
  const db = await supabaseServer();
  const { data, error } = await db.from("product_option").select("name").eq("kind", kind);
  if (error) return { ok: false, error: error.message };
  const exact = data.find((r) => optionKey(r.name) === optionKey(name));
  if (exact) return { ok: true, name: exact.name };
  const similar = data.filter((r) => similarOption(r.name, name));
  if (similar.length) return { ok: false, error: `A similar option exists: ${similar.map((r) => r.name).join(", ")}. Select it from the list.` };
  const result = await db.from("product_option").insert({ kind, name }).select("name").single();
  if (result.error?.code === "23505") {
    const retry = await db.from("product_option").select("name").eq("kind", kind);
    const match = retry.data?.find((r) => optionKey(r.name) === optionKey(name));
    if (match) return { ok: true, name: match.name };
  }
  if (result.error) return { ok: false, error: result.error.message };
  return { ok: true, name: result.data.name };
}
