"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { one } from "@/lib/decimal";
import type { ActionResult } from "./partners";

/**
 * Service level policies.
 *
 * cases.ts already applies these on every case: it looks up an active policy
 * for the case's priority and stamps firstResponseDueAt and resolutionDueAt
 * from it. With the table empty that lookup found nothing and every case was
 * created with no deadline at all — the SLA engine ran but decided nothing.
 *
 * One active policy per priority is the rule. Two would make the lookup depend
 * on insertion order, which is how a critical case silently ends up on a
 * low-priority clock.
 */

export interface SlaPolicyRow {
  id: string;
  name: string;
  priority: string;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  pauseOnCustomerWait: boolean;
  active: boolean;
  businessHours: { id: string; name: string; timezone: string } | null;
}

export async function listSlaPolicies(): Promise<SlaPolicyRow[]> {
  await requireUser();
  const db = await supabaseServer();

  const { data, error } = await db
    .from("sla_policy")
    .select("*, businessHours:business_hours ( id, name, timezone )")
    .order("priority")
    .order("name");

  if (error) throw new Error(`Could not load SLA policies: ${error.message}`);

  return (data ?? []).map((p) => ({
    ...p,
    businessHours: one(p.businessHours as never),
  })) as SlaPolicyRow[];
}

export async function listBusinessHours() {
  await requireUser();
  const db = await supabaseServer();

  const { data } = await db
    .from("business_hours")
    .select("id, name, timezone, isDefault, active, weeklySchedule")
    .eq("active", true)
    .order("name");

  return data ?? [];
}

const policySchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1, "Give the policy a name.").max(150),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  firstResponseMinutes: z.coerce
    .number()
    .int()
    .positive("A first response target has to be more than zero."),
  resolutionMinutes: z.coerce
    .number()
    .int()
    .positive("A resolution target has to be more than zero."),
  businessHoursId: z.string().uuid().optional().nullable().or(z.literal("")),
  pauseOnCustomerWait: z.coerce.boolean().default(true),
  active: z.coerce.boolean().default(true),
});

export async function saveSlaPolicy(
  input: z.infer<typeof policySchema>,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) {
    return { ok: false, error: "Only an administrator can change SLA policies." };
  }

  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the values.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  if (d.resolutionMinutes < d.firstResponseMinutes) {
    return {
      ok: false,
      error: "Resolution cannot be due before the first response.",
      fieldErrors: { resolutionMinutes: ["Must be at least the first response target."] },
    };
  }

  const db = await supabaseServer();

  // One active policy per priority: the case lookup takes the first match, so a
  // second active row for the same priority makes which clock applies a matter
  // of insertion order.
  if (d.active) {
    const { data: clash } = await db
      .from("sla_policy")
      .select("id, name")
      .eq("priority", d.priority)
      .eq("active", true)
      .maybeSingle();

    if (clash && clash.id !== d.id) {
      return {
        ok: false,
        error: `"${clash.name}" is already the active ${d.priority.toLowerCase()} policy. Deactivate it first, or edit it instead.`,
      };
    }
  }

  const now = new Date().toISOString();
  const values = {
    name: d.name,
    priority: d.priority,
    firstResponseMinutes: d.firstResponseMinutes,
    resolutionMinutes: d.resolutionMinutes,
    businessHoursId: d.businessHoursId || null,
    pauseOnCustomerWait: d.pauseOnCustomerWait,
    active: d.active,
    updatedAt: now,
  };

  const { error } = d.id
    ? await db.from("sla_policy").update(values).eq("id", d.id)
    : await db.from("sla_policy").insert({ id: randomUUID(), ...values });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true, data: { id: d.id || "new" } };
}

export async function deleteSlaPolicy(id: string): Promise<ActionResult> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) {
    return { ok: false, error: "Only an administrator can remove SLA policies." };
  }

  const db = await supabaseServer();

  // Cases point at the policy that was in force when they were raised. Removing
  // it would orphan that reference and lose why a given deadline was set, so an
  // in-use policy is deactivated rather than deleted.
  const { count } = await db
    .from("support_case")
    .select("id", { count: "exact", head: true })
    .eq("slaPolicyId", id);

  if ((count ?? 0) > 0) {
    const { error } = await db
      .from("sla_policy")
      .update({ active: false, updatedAt: new Date().toISOString() })
      .eq("id", id);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/settings");
    return {
      ok: false,
      error: `${count} case(s) were raised under this policy, so it has been deactivated rather than deleted - their deadlines still refer to it.`,
    };
  }

  const { error } = await db.from("sla_policy").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
