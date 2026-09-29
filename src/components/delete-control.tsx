import { getRecycleState } from "@/server/recycle-bin";
import { RECYCLE_TYPES, type RecycleType } from "@/lib/recycle-types";
import { DeleteRecordButton } from "./delete-record";

/** Delete or Restore for a record's header, shown only to those who may. */
export async function DeleteControl({ type, id, name }: { type: RecycleType; id: string; name: string }) {
  const state = await getRecycleState(type, id).catch(() => null);
  if (!state?.canDelete) return null;
  return (
    <DeleteRecordButton
      type={type}
      id={id}
      name={name || "this record"}
      deleted={state.deleted}
      blocker={state.blocker}
      listPath={RECYCLE_TYPES[type].path.slice(0, -1)}
    />
  );
}
