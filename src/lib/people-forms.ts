/**
 * The hiring forms' state, and turning saved rows into it. Kept out of the
 * "use client" form file so server pages can prepare initial values (a
 * renewal starts from the contract it follows).
 */
import { termEndDate, karachiToday, type EducationEntry, type ExperienceEntry } from "./people";

export interface ProfileState {
  fullName: string;
  fatherName: string;
  nationalId: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  personalEmail: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  emergencyContactName: string;
  emergencyContactRelation: string;
  emergencyContactPhone: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  skills: string[];
  education: EducationEntry[];
  experience: ExperienceEntry[];
  notes: string;
}

export const EMPTY_PROFILE: ProfileState = {
  fullName: "", fatherName: "", nationalId: "", dateOfBirth: "", gender: "", maritalStatus: "",
  personalEmail: "", phone: "", address: "", city: "", country: "Pakistan",
  emergencyContactName: "", emergencyContactRelation: "", emergencyContactPhone: "",
  linkedinUrl: "", githubUrl: "", portfolioUrl: "", skills: [], education: [], experience: [], notes: "",
};

/** A saved profile row as the form's state. */
export function profileState(row: Record<string, unknown>): ProfileState {
  const s = (k: string) => (row[k] == null ? "" : String(row[k]));
  return {
    ...EMPTY_PROFILE,
    ...Object.fromEntries(Object.keys(EMPTY_PROFILE).filter((k) => !["skills", "education", "experience"].includes(k)).map((k) => [k, s(k)])),
    skills: (row.skills as string[]) ?? [],
    education: (row.education as EducationEntry[]) ?? [],
    experience: (row.experience as ExperienceEntry[]) ?? [],
  } as ProfileState;
}

export interface TermsState {
  contractType: string;
  tenureMonths: number;
  startDate: string;
  endDate: string;
  jobTitle: string;
  departmentId: string;
  reportsToUserId: string;
  roleId: string;
  teamIds: string[];
  hoursPerWeek: string;
  payBasis: string;
  payAmount: string;
  currencyCode: string;
  benefits: string[];
  otherTerms: string;
  noticeDays: number;
  templateId: string;
}

export function emptyTerms(currency = "PKR"): TermsState {
  const start = karachiToday();
  return {
    contractType: "INTERNSHIP", tenureMonths: 3, startDate: start, endDate: termEndDate(start, 3),
    jobTitle: "", departmentId: "", reportsToUserId: "", roleId: "", teamIds: [], hoursPerWeek: "40",
    payBasis: "NONE", payAmount: "", currencyCode: currency, benefits: [], otherTerms: "", noticeDays: 14, templateId: "",
  };
}

/** A saved contract as the form's state, for editing or as the base of a renewal. */
export function termsState(row: Record<string, unknown>): TermsState {
  const s = (k: string) => (row[k] == null ? "" : String(row[k]));
  return {
    contractType: s("contractType") || "INTERNSHIP",
    tenureMonths: Number(row.tenureMonths ?? 3),
    startDate: s("startDate"),
    endDate: s("endDate"),
    jobTitle: s("jobTitle"),
    departmentId: s("departmentId"),
    reportsToUserId: s("reportsToUserId"),
    roleId: s("roleId"),
    teamIds: (row.teamIds as string[]) ?? [],
    hoursPerWeek: s("hoursPerWeek"),
    payBasis: s("payBasis") || "NONE",
    payAmount: s("payAmount"),
    currencyCode: s("currencyCode") || "PKR",
    benefits: (row.benefits as string[]) ?? [],
    otherTerms: s("otherTerms"),
    noticeDays: Number(row.noticeDays ?? 14),
    templateId: s("templateId"),
  };
}

/** Terms as the server action takes them. */
export function termsInput(t: TermsState) {
  return {
    ...t,
    hoursPerWeek: t.hoursPerWeek || null,
    payAmount: t.payBasis === "NONE" ? null : t.payAmount,
    departmentId: t.departmentId || null,
    reportsToUserId: t.reportsToUserId || null,
    roleId: t.roleId || null,
    templateId: t.templateId || null,
  };
}
