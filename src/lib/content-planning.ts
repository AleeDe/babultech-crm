import { z } from "zod";
export const CONTENT_CHANNELS = ["FACEBOOK", "INSTAGRAM", "LINKEDIN", "TIKTOK", "YOUTUBE", "WEBSITE", "EMAIL", "OTHER"] as const;
export const CONTENT_FORMATS = ["POST", "CAROUSEL", "SHORT_VIDEO", "VIDEO", "ARTICLE", "EMAIL", "OTHER"] as const;
export const contentPlanSchema = z.object({
 taskId: z.string().uuid(), expectedRevision: z.number().int().min(0),
 plan: z.object({ channel: z.enum(CONTENT_CHANNELS), format: z.enum(CONTENT_FORMATS), objective: z.string().trim().min(1).max(2000), audience: z.string().trim().min(1).max(2000), brief: z.string().trim().min(1).max(8000), plannedPublishAt: z.string().datetime(), clientApprovalRequired: z.boolean() }),
});
export type ContentPlan = z.infer<typeof contentPlanSchema>["plan"] & { taskId: string; revision: number };
export function contentMonth(value?: string, now = new Date()) {
 const current = new Date(now.getTime() + 5 * 3600000).toISOString().slice(0, 7);
 const month = value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "2000-01" && value <= "2100-12" ? value : current;
 const [year, number] = month.split("-").map(Number);
 const shift = (offset: number) => new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
 return { month, previous: shift(-1), next: shift(1), start: new Date(`${month}-01T00:00:00+05:00`).toISOString(), end: new Date(`${shift(1)}-01T00:00:00+05:00`).toISOString() };
}
