/** The events a webhook can listen for. Raised by webhook_events_trigger() (20261001000004_webhooks.sql). */
export const WEBHOOK_EVENTS: { key: string; label: string }[] = [
  { key: "lead.created", label: "A lead is created" },
  { key: "opportunity.won", label: "A deal is won" },
  { key: "opportunity.lost", label: "A deal is lost" },
  { key: "quote.accepted", label: "A quote is accepted" },
  { key: "case.created", label: "A support case is created" },
  { key: "case.resolved", label: "A support case is resolved" },
];

/** Minutes to wait after each failed attempt; after the last, delivery is given up. */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 30, 120, 720];
