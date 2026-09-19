import { z } from "zod";

/**
 * Shapes shared by the dropdown lists (picklist / picklist_value).
 *
 * The values live in the database so an administrator can change them from
 * Settings. Forms keep their old hard-coded arrays as a fallback, so a form
 * still works if the lists have not loaded.
 */

export interface PicklistValue {
  id: string;
  value: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export interface Picklist {
  key: string;
  label: string;
  groupName: string;
  enumType: string | null;
  locked: boolean;
  description: string | null;
  values: PicklistValue[];
}

/** Active values of each list, in display order: what the forms read. */
export type PicklistMap = Record<string, { value: string; label: string }[]>;

/** Keys the code refers to. Kept in step with the seed in the migration. */
export type PicklistKey =
  | "lead_status" | "lead_rating" | "lead_source" | "industry" | "account_type"
  | "customer_status" | "health_status" | "preferred_channel" | "opportunity_stage"
  | "opportunity_type" | "campaign_status" | "activity_type" | "activity_status"
  | "priority" | "case_type" | "case_source" | "case_status" | "contract_status"
  | "billing_frequency" | "renewal_type" | "project_status" | "billing_type"
  | "task_status" | "task_type" | "task_category" | "risk_level" | "payment_method"
  | "user_status";

/**
 * A value from an open, enum-backed list. Administrators can add values in
 * Settings, so the server cannot hold a fixed list; the database enum is what
 * rejects a value that does not exist.
 */
export const picklistCode = z.string().regex(/^[A-Z0-9_]{1,100}$/, "Choose a value from the list.");

export const TASK_CATEGORIES = ["IMPLEMENTATION", "TRAINING"] as const;
