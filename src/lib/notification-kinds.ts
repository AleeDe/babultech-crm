/**
 * The kinds of notification, as the settings screen lists them.
 *
 * The database decides when each is sent (supabase/migrations/
 * 20260929000001_notifications_and_follows.sql); this is what they are called
 * and whether they go by email when nobody has said. Keep `emailByDefault` in
 * step with notification_email_by_default() there.
 */
export const NOTIFICATION_KINDS = [
  { kind: "ASSIGNED", label: "Assigned to me", description: "A lead, account, deal, case, project or task is given to you.", emailByDefault: true },
  { kind: "APPROVAL_REQUESTED", label: "Approval needed", description: "A quote, expense or other request is waiting for your approval.", emailByDefault: true },
  { kind: "APPROVAL_DECIDED", label: "Approval decided", description: "Something you asked to have approved was approved or rejected.", emailByDefault: true },
  { kind: "MENTION", label: "Mentioned in a note", description: "Someone @mentions you. The email for this is sent by the note itself.", emailByDefault: false, emailFixed: true },
  { kind: "CASE_CUSTOMER_REPLY", label: "Customer replied", description: "A customer writes on a case you own or follow.", emailByDefault: false },
  { kind: "PARTNER_LEAD", label: "Partner registered a lead", description: "A partner you manage adds a lead in the portal.", emailByDefault: false },
  { kind: "QUOTE_ACCEPTED", label: "Quote accepted", description: "A quote on your deal, or a deal you follow, is accepted.", emailByDefault: false },
  { kind: "DEAL_WON", label: "Deal won", description: "A deal you own or follow is closed won.", emailByDefault: false },
  { kind: "TASK_DUE", label: "Due tomorrow and overdue", description: "Checked every morning for your tasks, calls, meetings and project tasks.", emailByDefault: false },
  { kind: "FOLLOWED_CHANGE", label: "Records I follow", description: "The stage, status or owner changes, or a note is added.", emailByDefault: false },
  { kind: "JOB_FINISHED", label: "Background work finished", description: "A mass email or import you started has finished.", emailByDefault: false },
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]["kind"];

export const FOLLOWABLE_TYPES = ["Lead", "Account", "Contact", "Opportunity", "SupportCase", "Project"] as const;
export type FollowableType = (typeof FOLLOWABLE_TYPES)[number];
