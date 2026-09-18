import { z } from "zod";
import { pakistanInputToIso } from "./calling";
export function publicationInputToIso(value: string): string | null {
 if (value.length === 16) return pakistanInputToIso(value);
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return null;
 const date = new Date(`${value}+05:00`);
 if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 5 * 3600000).toISOString().slice(0, 19) !== value) return null;
 return date.toISOString();
}
const httpUrl = z.string().trim().max(2048).url().refine(value => /^https?:\/\//i.test(value), "Use an HTTP(S) URL.");
export const versionSchema = z.object({ id: z.string().uuid(), taskId: z.string().uuid(), expected: z.number().int().min(0), planRevision: z.number().int().positive(), copy: z.string().trim().min(1).max(20000), assetUrl: httpUrl.nullable(), assetSha: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/).nullable() }).refine(v => Boolean(v.assetUrl) === Boolean(v.assetSha), "Asset URL and SHA-256 must be supplied together.");
export const reviewSchema = z.object({ id: z.string().uuid(), versionId: z.string().uuid(), stage: z.enum(["INTERNAL", "CLIENT"]), decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]), evidence: z.string().trim().min(1).max(4000), client: z.string().trim().min(1).max(200).nullable() }).refine(v => v.stage === "CLIENT" ? Boolean(v.client) : v.client === null, "Client review needs the client's approver name.");
export const publicationSchema = z.object({ id: z.string().uuid(), versionId: z.string().uuid(), url: httpUrl, publishedAt: z.string().datetime().refine(value => new Date(value).getTime() <= Date.now(), "Publication time cannot be in the future.") });
export type ContentVersionRow = { id: string; taskId: string; versionNumber: number; planRevision: number; planSnapshot: { clientApprovalRequired: boolean; channel: string; format: string; brief: string }; copy: string; assetUrl: string | null; assetSha256: string | null; createdById: string; createdAt: string; author: { fullName: string } | null;
 reviews: { id: string; stage: string; decision: string; evidence: string; clientApprover: string | null; viaLinkId: string | null; createdAt: string; reviewer: { fullName: string } | null }[];
 publications: { id: string; liveUrl: string; publishedAt: string; createdAt: string }[];
};
