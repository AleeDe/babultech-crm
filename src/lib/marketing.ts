/**
 * The kinds of campaign touch, as the screens name them. The database
 * accepts exactly these (campaign_interaction's check constraint).
 */
export const INTERACTION_TYPES = [
  { value: "FORM_SUBMIT", label: "Submitted a website form" },
  { value: "EMAIL_OPEN", label: "Opened an email" },
  { value: "EMAIL_CLICK", label: "Clicked an email" },
  { value: "EVENT_ATTENDED", label: "Attended an event" },
  { value: "WEBINAR_ATTENDED", label: "Attended a webinar" },
  { value: "CALL", label: "Call about the campaign" },
  { value: "MEETING", label: "Meeting" },
  { value: "REFERRAL", label: "Referral" },
  { value: "WEBSITE_VISIT", label: "Visited the website" },
  { value: "SOCIAL", label: "Social media" },
  { value: "DOWNLOAD", label: "Downloaded something" },
  { value: "OTHER", label: "Other" },
] as const;

export function interactionLabel(value: string): string {
  return INTERACTION_TYPES.find((t) => t.value === value)?.label ?? value;
}

/** The fields a web form may ask for, in the order they are offered. */
export const WEB_FORM_FIELDS = [
  { key: "firstName", label: "First name", type: "text" },
  { key: "lastName", label: "Last name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "companyName", label: "Company", type: "text" },
  { key: "jobTitle", label: "Job title", type: "text" },
  { key: "website", label: "Website", type: "url" },
  { key: "city", label: "City", type: "text" },
  { key: "country", label: "Country", type: "text" },
  { key: "message", label: "Message", type: "textarea" },
] as const;

export const ATTRIBUTION_MODELS = [
  { value: "PRIMARY", label: "Primary campaign", help: "The campaign set on the deal." },
  { value: "FIRST", label: "First touch", help: "The campaign that first brought the person in." },
  { value: "LEAD_CREATION", label: "Lead creation", help: "The campaign the lead was made from." },
  { value: "LATEST", label: "Latest touch", help: "The last campaign they engaged with before becoming a deal." },
] as const;
