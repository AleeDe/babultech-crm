import { supabaseServer } from "./supabase";

/**
 * Ceiling on rows returned by a list screen.
 *
 * PostgREST defaults to unbounded, so a list query grew with the table and the
 * page rendered every row it was handed. Well past this many rows the screen is
 * unusable anyway — the answer there is a filter, not a longer page.
 */
export const LIST_LIMIT = 500;

/** Rows per page on the expense list. Lives here because a "use server" module
 *  may only export async functions. */
export const EXPENSE_PAGE_SIZE = 25;

/**
 * Case-insensitive "contains" across several columns.
 *
 * PostgREST's or() takes a comma-separated filter list, so a comma or a
 * parenthesis in the search term would be read as syntax rather than text.
 * Stripping them is what stops a stray bracket turning into a malformed query.
 *
 *   query = applySearch(query, term, ["name", "invoiceNumber"]);
 */
export function applySearch<Q extends { or: (filter: string) => Q }>(
  query: Q,
  term: string | undefined,
  columns: readonly string[],
): Q {
  const cleaned = term?.replace(/[,()]/g, "").trim();
  if (!cleaned) return query;

  return query.or(columns.map((c) => `${c}.ilike.%${cleaned}%`).join(","));
}

/**
 * Atomic write helpers.
 *
 * These wrap the `create_record` / `update_record` database functions (see
 * supabase/functions-sql/014_fn_generic_write.sql). They exist because supabase-js has no
 * transaction API: a create that allocates a sequence number, or an update that
 * must also write change history, cannot be two HTTP calls without risking a
 * burnt number or a lost audit row.
 *
 * Reads stay as ordinary supabase-js queries — only multi-step writes come
 * through here.
 */

/** Insert a row, allocating its human-readable number in the same transaction. */
export async function createRecord<T = Record<string, unknown>>(
  table: string,
  payload: Record<string, unknown>,
  numbering?: { field: string; sequence: string },
): Promise<T> {
  const db = await supabaseServer();

  const { data, error } = await db.rpc("create_record", {
    p_table: table,
    p_payload: payload,
    p_number_field: numbering?.field ?? null,
    p_sequence: numbering?.sequence ?? null,
  });

  if (error) throw new Error(error.message);
  return data as T;
}

/**
 * Update a row and write one audit_history row per changed audited field.
 *
 * `entityType` is the logical name used in audit history ("Account", "Lead"),
 * which is not always the table name.
 */
export async function updateRecord<T = Record<string, unknown>>(
  table: string,
  id: string,
  payload: Record<string, unknown>,
  entityType: string,
  actorId: string,
): Promise<T> {
  const db = await supabaseServer();

  const { data, error } = await db.rpc("update_record", {
    p_table: table,
    p_id: id,
    p_payload: payload,
    p_entity_type: entityType,
    p_actor_id: actorId,
  });

  if (error) throw new Error(error.message);
  return data as T;
}

/**
 * Applies a scopeFilter() result to a PostgREST query.
 *
 * scopeFilter returns Prisma-shaped clauses — `{ ownerUserId: "x" }` or
 * `{ ownerUserId: { in: [...] } }` — so this translates them rather than
 * rewriting every call site's scoping logic.
 */
export function applyScope<Q extends { eq: (c: string, v: unknown) => Q; in: (c: string, v: readonly unknown[]) => Q }>(
  query: Q,
  where: Record<string, unknown>,
): Q {
  for (const [column, clause] of Object.entries(where)) {
    if (clause && typeof clause === "object" && "in" in clause) {
      query = query.in(column, (clause as { in: unknown[] }).in);
    } else {
      query = query.eq(column, clause);
    }
  }
  return query;
}
