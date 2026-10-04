import { Alert } from "@/components/ui";
import { getCorrectionState } from "@/server/corrections";
import { formatDateTime } from "@/lib/utils";
import { CorrectButton } from "./correct-button";

/**
 * Wraps an edit page's form. Before a record is processed the form shows as
 * usual. Afterwards: anyone but an administrator reads why it is locked; an
 * administrator is asked for a reason first, and then sees the form under a
 * banner saying a correction is open. `wordingForm` replaces the form for a
 * document the customer holds (an issued invoice, a sent quote).
 */
export async function CorrectionGate({
  type,
  id,
  children,
  wordingForm,
  quietForOthers = false,
}: {
  type: string;
  id: string;
  children?: React.ReactNode;
  wordingForm?: React.ReactNode;
  /** The page already says why it is locked; add nothing for non-administrators. */
  quietForOthers?: boolean;
}) {
  const state = await getCorrectionState(type, id);
  if (!state || !state.processed) return <>{children}</>;

  if (!state.isAdmin) {
    if (quietForOthers) return null;
    return (
      <Alert tone="info">
        {state.processed} Only an administrator can change it now. If something on it is wrong, ask one to correct it.
      </Alert>
    );
  }

  if (!state.open) {
    return (
      <div className="space-y-4">
        <Alert tone="warning">
          {state.processed} You can still correct it as an administrator. Say what was wrong first.
          {state.wordingOnly && " The customer has this document, so its amounts and lines stay as they are; correct its wording, dates and references here, and change the figures with a credit note or a new version."}
        </Alert>
        <CorrectButton type={type} id={id} inline />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert tone="warning">
        <span className="font-medium">Correcting:</span> {state.open.reason}
        <span className="block text-xs">
          Opened by {state.open.openedByName ?? "an administrator"}; open until {formatDateTime(state.open.expiresAt)}. Every change
          is kept in the history.
        </span>
      </Alert>
      {state.wordingOnly && wordingForm ? wordingForm : children}
    </div>
  );
}

/** The Correct button for a record's header: administrators, on processed records. */
export async function CorrectControl({ type, id }: { type: string; id: string }) {
  const state = await getCorrectionState(type, id).catch(() => null);
  if (!state?.processed || !state.isAdmin) return null;
  return <CorrectButton type={type} id={id} />;
}
