/**
 * Whether each piloted workflow can actually be run yet.
 *
 * The staff pilot runbook records what was true on the day it was written. This
 * works it out from the live grants and record counts instead, so it stays
 * right after roles change or real work arrives.
 *
 * Read-only, and deliberately blunt: a workflow is either runnable or it says
 * what is missing. "Probably fine" helps nobody planning a pilot.
 */

/** The same wildcard matching the application and the database policies use. */
export function grants(permissions: readonly string[], permission: string) {
  const [group, action] = permission.split(":");
  return permissions.some((held) =>
    held === "*" || held === permission || held === `${group}:*` || held === `*:${action}`,
  );
}

export type PilotUser = {
  fullName: string;
  status: string;
  deletedAt: string | null;
  partnerId: string | null;
  role: { name: string; dataScope: string; permissions: string[]; active: boolean } | null;
};

export type PilotCounts = {
  leads: number;
  customers: number;
  contracts: number;
  invoices: number;
  projects: number;
  tasks: number;
  contentPlans: number;
};

export type WorkflowReadiness = {
  workflow: string;
  ready: boolean;
  /** Who could run it today. */
  people: string[];
  /** Why it cannot be run, in the order worth fixing. */
  blockers: string[];
};

function activeStaff(users: PilotUser[]) {
  return users.filter((u) =>
    u.status === "ACTIVE" && !u.deletedAt && !u.partnerId && u.role?.active,
  );
}

/** Staff holding every one of these permissions at once. */
export function holdersOfAll(users: PilotUser[], permissions: string[]) {
  return activeStaff(users)
    .filter((u) => permissions.every((p) => grants(u.role?.permissions ?? [], p)))
    .map((u) => u.fullName);
}

export function assessPilot(users: PilotUser[], counts: PilotCounts): WorkflowReadiness[] {
  const callers = holdersOfAll(users, ["lead:read", "lead:write"]);
  const handoffRecipients = holdersOfAll(users, ["lead:read", "lead:write", "opportunity:write"]);
  const projectManagers = holdersOfAll(users, ["project:manage"]);
  const salesWithDelivery = holdersOfAll(users, ["opportunity:write"]);
  const invoiceDrafters = holdersOfAll(users, ["invoice:write"]);
  const invoiceIssuers = holdersOfAll(users, ["invoice:approve"]);
  const accountReaders = holdersOfAll(users, ["account:read"]);
  const contractReaders = holdersOfAll(users, ["opportunity:read"]);

  const workflows: WorkflowReadiness[] = [];

  // --- Calling queue ---
  {
    const blockers: string[] = [];
    if (callers.length === 0) blockers.push("Nobody holds lead:read and lead:write, so the calling queue cannot be opened.");
    if (counts.leads === 0) blockers.push("There are no leads to call.");
    workflows.push({ workflow: "Leads: calling queue", ready: blockers.length === 0, people: callers, blockers });
  }

  // --- Sales handoff ---
  {
    const blockers: string[] = [];
    if (callers.length === 0) blockers.push("Nobody can qualify a lead (needs lead:read and lead:write).");
    if (handoffRecipients.length === 0) {
      blockers.push("Nobody can receive a handoff: it needs lead:read, lead:write and opportunity:write held by the same person.");
    } else if (callers.length === 1 && handoffRecipients.length === 1 && callers[0] === handoffRecipients[0]) {
      blockers.push(`Only ${callers[0]} can both send and receive, and a handoff needs two different people.`);
    }
    if (counts.leads === 0) blockers.push("There are no leads to hand over.");
    workflows.push({ workflow: "Leads: sales handoff", ready: blockers.length === 0, people: handoffRecipients, blockers });
  }

  // --- Research queue ---
  {
    const blockers: string[] = [];
    if (holdersOfAll(users, ["lead:read"]).length === 0) blockers.push("Nobody holds lead:read.");
    if (counts.leads === 0) blockers.push("There are no leads to review.");
    workflows.push({
      workflow: "Leads: research quality",
      ready: blockers.length === 0,
      people: holdersOfAll(users, ["lead:read"]),
      blockers,
    });
  }

  // --- Delivery handoff ---
  {
    const blockers: string[] = [];
    if (salesWithDelivery.length === 0) blockers.push("Nobody holds opportunity:write to submit a delivery handoff.");
    if (projectManagers.length === 0) blockers.push("Nobody holds project:manage to accept one.");
    workflows.push({
      workflow: "Delivery handoff",
      ready: blockers.length === 0,
      people: [...new Set([...salesWithDelivery, ...projectManagers])],
      blockers,
    });
  }

  // --- Content, the one that needs two different people ---
  {
    const blockers: string[] = [];
    if (projectManagers.length === 0) {
      blockers.push("Nobody holds project:manage, so no content plan can be created or reviewed.");
    } else if (projectManagers.length === 1) {
      // The author cannot review their own version. One manager means whoever
      // writes it has nobody else who can approve it.
      blockers.push(`Only ${projectManagers[0]} holds project:manage, and a version cannot be reviewed by whoever wrote it.`);
    }
    if (counts.projects === 0) blockers.push("There are no projects to plan content against.");
    if (counts.tasks === 0) blockers.push("There are no tasks to attach a content plan to.");
    workflows.push({ workflow: "Content: plan, review, publish", ready: blockers.length === 0, people: projectManagers, blockers });
  }

  // --- Client review link ---
  {
    const blockers: string[] = [];
    if (projectManagers.length === 0) blockers.push("Nobody holds project:manage to send a client review link.");
    if (counts.contentPlans === 0) blockers.push("No content plan exists yet, so there is nothing to send a client.");
    workflows.push({ workflow: "Client review link", ready: blockers.length === 0, people: projectManagers, blockers });
  }

  // --- Recurring billing and issuing ---
  {
    const blockers: string[] = [];
    if (invoiceDrafters.length === 0) blockers.push("Nobody holds invoice:write to raise a draft.");
    if (invoiceIssuers.length === 0) {
      blockers.push("Nobody holds invoice:approve to issue an invoice.");
    } else if (invoiceIssuers.length === 1 && invoiceDrafters.length === 1 && invoiceIssuers[0] === invoiceDrafters[0]) {
      blockers.push(`Only ${invoiceIssuers[0]} can both prepare and issue, and an invoice cannot be issued by whoever prepared it.`);
    }
    if (counts.contracts === 0) blockers.push("There are no contracts, so a recurring billing run has nothing to bill.");
    workflows.push({
      workflow: "Finance: recurring billing and issuing",
      ready: blockers.length === 0,
      people: [...new Set([...invoiceDrafters, ...invoiceIssuers])],
      blockers,
    });
  }

  // --- Period locking ---
  {
    const blockers: string[] = [];
    if (invoiceIssuers.length === 0) blockers.push("Nobody holds invoice:approve to close a period.");
    if (counts.invoices === 0) blockers.push("There is no financial activity, so no month can be closed yet.");
    workflows.push({ workflow: "Finance: closing a month", ready: blockers.length === 0, people: invoiceIssuers, blockers });
  }

  // --- Renewals ---
  {
    const blockers: string[] = [];
    if (contractReaders.length === 0) blockers.push("Nobody can read contracts.");
    if (counts.contracts === 0) blockers.push("There are no contracts, so nothing can come up for renewal.");
    workflows.push({ workflow: "Renewals", ready: blockers.length === 0, people: contractReaders, blockers });
  }

  // --- Account health ---
  {
    const blockers: string[] = [];
    if (accountReaders.length === 0) blockers.push("Nobody holds account:read.");
    if (counts.customers === 0) blockers.push("There are no customer accounts to assess.");
    workflows.push({ workflow: "Account health", ready: blockers.length === 0, people: accountReaders, blockers });
  }

  return workflows;
}

/** A one-line summary for the top of the report. */
export function summarise(workflows: WorkflowReadiness[]) {
  const ready = workflows.filter((w) => w.ready).length;
  return { ready, blocked: workflows.length - ready, total: workflows.length };
}
