import { z } from "zod";
const context = z.string().trim().min(1, "Complete each qualification field; use Unknown where appropriate.").max(2000);
export const qualificationSchema = z.object({ serviceInterest: context, need: context, authority: context, budget: context, timing: context, nextAction: context });
export const requestHandoffSchema = z.object({ id: z.string().uuid(), leadId: z.string().uuid(), recipientId: z.string().uuid(), qualification: qualificationSchema, followUpAt: z.string().datetime().refine(value => new Date(value).getTime() > Date.now(), "Choose a future next action.") });
export const decisionSchema = z.object({ id: z.string().uuid(), decision: z.enum(["ACCEPTED", "REJECTED", "CANCELLED"]), reason: context, followUpAt: z.string().datetime().nullable() }).superRefine((value, ctx) => {
  if (value.decision === "ACCEPTED" && (!value.followUpAt || new Date(value.followUpAt).getTime() <= Date.now())) ctx.addIssue({ code: "custom", path: ["followUpAt"], message: "Acceptance requires a future next action." });
});
export const qualificationLabels = { serviceInterest: "Service or product interest", need: "Business need", authority: "Contact authority", budget: "Budget understanding", timing: "Timing", nextAction: "Agreed next action" };
export type Handoff = { id: string; leadId: string; senderId: string; recipientId: string; leadLabel: string; senderName: string; recipientName: string; qualification: z.infer<typeof qualificationSchema>; followUpAt: string; acceptedFollowUpAt: string | null; status: string; reason: string | null; createdAt: string; decidedAt: string | null };
