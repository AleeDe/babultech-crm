/**
 * The data quality rules, as the page describes them. The rules themselves are
 * the view data_quality_issue (20261001000002_data_quality.sql).
 */
export const DATA_QUALITY_RULES: { key: string; title: string; why: string; fix: string }[] = [
  { key: "ACCOUNT_NO_CONTACTS", title: "Accounts with no contacts", why: "Nobody to call, email or invite to the portal.", fix: "Add the people you deal with." },
  { key: "ACCOUNT_NO_WEBSITE", title: "Accounts without a website", why: "The website is how duplicates are found and how a company is recognised.", fix: "Add the company's website." },
  { key: "CONTACT_NO_EMAIL", title: "Contacts without an email", why: "They cannot be emailed, invited to the portal or matched as duplicates.", fix: "Add an email address." },
  { key: "LEAD_NO_SOURCE", title: "Open leads without a source", why: "Without a source nobody can say which channel brings business.", fix: "Set where the lead came from." },
  { key: "LEAD_NO_ACTIVITY", title: "Open leads untouched for 14 days", why: "A lead goes cold fast.", fix: "Call or email, or disqualify it." },
  { key: "DEAL_NO_CLOSE_DATE", title: "Open deals without an expected close date", why: "They are left out of the forecast.", fix: "Set when it is expected to close." },
  { key: "DEAL_STALE", title: "Open deals unchanged for 21 days", why: "A deal nobody is moving is usually lost.", fix: "Update the stage or next step, or close it." },
  { key: "CASE_NO_OWNER", title: "Open cases without an owner", why: "Nobody is answering the customer.", fix: "Assign an owner." },
  { key: "PROJECT_NO_MANAGER", title: "Projects without a project manager", why: "Nobody is accountable for delivery.", fix: "Set the project manager." },
];
