import { supabaseServer } from "./supabase";

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
