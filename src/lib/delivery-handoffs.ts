import { z } from "zod";
export const deliveryFields = {
 contact: "Customer contact and account owner", scope: "Agreed scope / signed agreement reference", deliverables: "Deliverables and selected plans",
 exclusions: "Exclusions", dates: "Agreed dates and dependencies", billing: "Billing schedule and amounts",
 paymentEvidence: "Payment prerequisite and evidence / reason not required", acceptance: "Acceptance criteria", revisions: "Revision allowance", promises: "Sales promises and delivery risks",
};
const text = z.string().trim().min(1, "Complete every checklist field; state None or Not applicable where appropriate.").max(4000);
export const deliveryChecklistSchema = z.object({ contact: text, scope: text, deliverables: text, exclusions: text, dates: text, billing: text, paymentEvidence: text, acceptance: text, revisions: text, promises: text });
export const deliverySubmitSchema = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), quotationId: z.string().uuid(), checklist: deliveryChecklistSchema, paymentState: z.enum(["PENDING", "VERIFIED", "NOT_REQUIRED"]) });
export const deliveryDecisionSchema = z.object({ id: z.string().uuid(), decision: z.enum(["ACCEPTED", "RETURNED", "CANCELLED"]), reason: text, kickoffAt: z.string().datetime().nullable() }).superRefine((value, ctx) => {
 if (value.decision === "ACCEPTED" && (!value.kickoffAt || new Date(value.kickoffAt).getTime() <= Date.now())) ctx.addIssue({ code: "custom", message: "Choose a future kickoff date." });
});
export type DeliveryOptions = { projects: { id: string; name: string; manager: string }[]; quotes: { id: string; number: string; version: number }[] };
export type DeliveryHandoff = { id: string; projectId: string; senderId: string; recipientId: string; projectName: string; senderName: string; recipientName: string; quoteSnapshot: { number: string; version: number; amount: number; currency: string }; checklist: z.infer<typeof deliveryChecklistSchema>; paymentState: string; status: string; reason: string | null; kickoffAt: string | null; createdAt: string };
