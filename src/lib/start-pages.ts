/** The pages each kind of login may choose to land on after signing in. */
export const START_PAGES: Record<string, { href: string; label: string }[]> = {
  INTERNAL: [
    { href: "/", label: "Dashboard" },
    { href: "/my-work", label: "My work" },
    { href: "/leads", label: "Leads" },
    { href: "/opportunities", label: "Opportunities" },
    { href: "/opportunities/board", label: "Deal board" },
    { href: "/cases", label: "Support cases" },
    { href: "/projects", label: "Projects" },
    { href: "/reports", label: "Reports" },
  ],
  PARTNER: [
    { href: "/portal", label: "Overview" },
    { href: "/portal/deals", label: "Deals" },
    { href: "/portal/leads", label: "Leads" },
    { href: "/portal/customers", label: "Customers" },
  ],
  CUSTOMER: [
    { href: "/support", label: "My tickets" },
    { href: "/support/projects", label: "Projects" },
    { href: "/support/knowledge", label: "Help articles" },
  ],
};

/** Every time zone the server knows, for the preferences form. */
export function timeZoneList(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Asia/Karachi", "Asia/Dubai", "Europe/London", "America/New_York", "America/Toronto"];
  }
}
