import { listDeliverables } from "@/server/deliverables";
import { DeliverablesEditor } from "./deliverables-editor";

/** A project's deliverables: what is handed to the customer for approval. */
export async function DeliverablesPanel({
  projectId,
  milestones,
  canManage,
}: {
  projectId: string;
  milestones: { id: string; name: string }[];
  canManage: boolean;
}) {
  const deliverables = await listDeliverables(projectId).catch(() => []);
  return <DeliverablesEditor projectId={projectId} deliverables={deliverables} milestones={milestones} canManage={canManage} />;
}
