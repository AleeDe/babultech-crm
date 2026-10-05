"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  CONTRACT_TYPES, CONTRACT_TYPE_LABELS, TENURES, PAY_BASES, PAY_BASIS_LABELS,
  termEndDate, payLabel, tenureLabel,
  type EducationEntry, type ExperienceEntry,
} from "@/lib/people";
import type { ProfileState, TermsState } from "@/lib/people-forms";
import type { HiringOptions } from "@/server/people";

/**
 * The pieces of the hiring wizard, shared with editing a profile and with
 * preparing a renewal or conversion. Controlled: the parent holds the state
 * and saves it in one go. The state shapes and their helpers are in
 * lib/people-forms.ts, so server pages can build initial values too.
 */

type Errors = Record<string, string[] | undefined>;
const err = (errors: Errors | undefined, key: string) => errors?.[key]?.[0];

function useField<T extends object>(value: T, onChange: (next: T) => void) {
  return <K extends keyof T>(key: K) => ({
    value: value[key] as unknown as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange({ ...value, [key]: e.target.value }),
  });
}

// ---------------------------------------------------------------------------
// Profile: personal details and links
// ---------------------------------------------------------------------------

export function PersonalFields({ value, onChange, errors }: { value: ProfileState; onChange: (v: ProfileState) => void; errors?: Errors }) {
  const f = useField(value, onChange);
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={err(errors, "fullName")}><Input name="fullName" {...f("fullName")} /></Field>
        <Field label="Father's name"><Input name="fatherName" {...f("fatherName")} /></Field>
        <Field label="CNIC / national ID" hint="Printed on the contract."><Input name="nationalId" placeholder="35202-1234567-1" {...f("nationalId")} /></Field>
        <Field label="Date of birth"><Input name="dateOfBirth" type="date" {...f("dateOfBirth")} /></Field>
        <Field label="Gender">
          <Select name="gender" {...f("gender")}>
            <option value="">Not given</option><option>Male</option><option>Female</option><option>Other</option>
          </Select>
        </Field>
        <Field label="Marital status">
          <Select name="maritalStatus" {...f("maritalStatus")}>
            <option value="">Not given</option><option>Single</option><option>Married</option>
          </Select>
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Personal email" hint="Where the signing link is sent." error={err(errors, "personalEmail")}><Input name="personalEmail" type="email" {...f("personalEmail")} /></Field>
        <Field label="Phone"><Input name="phone" {...f("phone")} /></Field>
        <div className="sm:col-span-2"><Field label="Address"><Input name="address" {...f("address")} /></Field></div>
        <Field label="City"><Input name="city" {...f("city")} /></Field>
        <Field label="Country"><Input name="country" {...f("country")} /></Field>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Emergency contact</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name"><Input name="emergencyContactName" {...f("emergencyContactName")} /></Field>
          <Field label="Relation"><Input name="emergencyContactRelation" placeholder="Father, spouse…" {...f("emergencyContactRelation")} /></Field>
          <Field label="Phone"><Input name="emergencyContactPhone" {...f("emergencyContactPhone")} /></Field>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Online profiles</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="LinkedIn" error={err(errors, "linkedinUrl")}><Input name="linkedinUrl" placeholder="https://www.linkedin.com/in/…" {...f("linkedinUrl")} /></Field>
          <Field label="GitHub" error={err(errors, "githubUrl")}><Input name="githubUrl" placeholder="https://github.com/…" {...f("githubUrl")} /></Field>
          <Field label="Portfolio or website" error={err(errors, "portfolioUrl")}><Input name="portfolioUrl" placeholder="https://…" {...f("portfolioUrl")} /></Field>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile: education, experience and skills
// ---------------------------------------------------------------------------

export function BackgroundFields({ value, onChange, errors }: { value: ProfileState; onChange: (v: ProfileState) => void; errors?: Errors }) {
  const [skill, setSkill] = useState("");
  const setEdu = (i: number, patch: Partial<EducationEntry>) =>
    onChange({ ...value, education: value.education.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const setExp = (i: number, patch: Partial<ExperienceEntry>) =>
    onChange({ ...value, experience: value.experience.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const addSkill = () => {
    const parts = skill.split(",").map((s) => s.trim()).filter(Boolean).filter((s) => !value.skills.includes(s));
    if (parts.length) onChange({ ...value, skills: [...value.skills, ...parts] });
    setSkill("");
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Education</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, education: [...value.education, { degree: "", institution: "" }] })}>
            <Plus className="h-4 w-4" /> Add education
          </Button>
        </div>
        {value.education.length === 0 && <p className="text-sm text-muted-foreground">None added.</p>}
        <div className="space-y-3">
          {value.education.map((e, i) => (
            <div key={i} className="grid gap-3 rounded-md border p-3 sm:grid-cols-6" data-education-row={i}>
              <div className="sm:col-span-2"><Field label="Degree or certificate" error={err(errors, `education.${i}.degree`)}><Input name={`education.${i}.degree`} placeholder="BS Computer Science" value={e.degree} onChange={(ev) => setEdu(i, { degree: ev.target.value })} /></Field></div>
              <div className="sm:col-span-2"><Field label="Institution" error={err(errors, `education.${i}.institution`)}><Input name={`education.${i}.institution`} value={e.institution} onChange={(ev) => setEdu(i, { institution: ev.target.value })} /></Field></div>
              <Field label="From"><Input name={`education.${i}.startYear`} placeholder="2020" value={e.startYear ?? ""} onChange={(ev) => setEdu(i, { startYear: ev.target.value })} /></Field>
              <Field label="To"><Input name={`education.${i}.endYear`} placeholder="2024" value={e.endYear ?? ""} onChange={(ev) => setEdu(i, { endYear: ev.target.value })} /></Field>
              <div className="sm:col-span-3"><Field label="Field of study"><Input value={e.field ?? ""} onChange={(ev) => setEdu(i, { field: ev.target.value })} /></Field></div>
              <div className="sm:col-span-2"><Field label="Grade / CGPA"><Input value={e.grade ?? ""} onChange={(ev) => setEdu(i, { grade: ev.target.value })} /></Field></div>
              <div className="flex items-end justify-end">
                <Button type="button" variant="ghost" size="sm" aria-label="Remove this education" onClick={() => onChange({ ...value, education: value.education.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Work experience</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, experience: [...value.experience, { company: "", title: "" }] })}>
            <Plus className="h-4 w-4" /> Add experience
          </Button>
        </div>
        {value.experience.length === 0 && <p className="text-sm text-muted-foreground">None added. Fine for a fresh graduate.</p>}
        <div className="space-y-3">
          {value.experience.map((e, i) => (
            <div key={i} className="grid gap-3 rounded-md border p-3 sm:grid-cols-6" data-experience-row={i}>
              <div className="sm:col-span-2"><Field label="Company" error={err(errors, `experience.${i}.company`)}><Input name={`experience.${i}.company`} value={e.company} onChange={(ev) => setExp(i, { company: ev.target.value })} /></Field></div>
              <div className="sm:col-span-2"><Field label="Position" error={err(errors, `experience.${i}.title`)}><Input name={`experience.${i}.title`} value={e.title} onChange={(ev) => setExp(i, { title: ev.target.value })} /></Field></div>
              <Field label="From"><Input type="month" value={e.startDate ?? ""} onChange={(ev) => setExp(i, { startDate: ev.target.value })} /></Field>
              <Field label="To" hint="Empty if current"><Input type="month" value={e.endDate ?? ""} onChange={(ev) => setExp(i, { endDate: ev.target.value })} /></Field>
              <div className="sm:col-span-5"><Field label="What they did"><Textarea rows={2} value={e.summary ?? ""} onChange={(ev) => setExp(i, { summary: ev.target.value })} /></Field></div>
              <div className="flex items-end justify-end">
                <Button type="button" variant="ghost" size="sm" aria-label="Remove this experience" onClick={() => onChange({ ...value, experience: value.experience.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Skills</h3>
        <div className="flex gap-2">
          <Input name="skill" placeholder="React, SEO, Manual testing…" value={skill} onChange={(e) => setSkill(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }} />
          <Button type="button" variant="outline" onClick={addSkill}>Add</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.skills.map((s) => (
            <button key={s} type="button" className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted" title="Remove"
              onClick={() => onChange({ ...value, skills: value.skills.filter((x) => x !== s) })}>
              {s} ×
            </button>
          ))}
        </div>
      </section>

      <Field label="Notes" hint="Anything else worth keeping: how they were found, interview notes.">
        <Textarea name="notes" rows={3} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contract: position and term
// ---------------------------------------------------------------------------

export function PositionFields({ value, onChange, options, errors, selfUserId }: {
  value: TermsState; onChange: (v: TermsState) => void; options: HiringOptions; errors?: Errors; selfUserId?: string | null;
}) {
  const f = useField(value, onChange);
  const permanent = value.contractType === "PERMANENT";
  const custom = !TENURES.some((t) => t.months === value.tenureMonths);

  // The end date follows the start and tenure; it can still be changed by hand.
  const setTerm = (patch: Partial<TermsState>) => {
    const next = { ...value, ...patch };
    if (next.contractType === "PERMANENT") next.tenureMonths = 12;
    if (next.startDate && next.tenureMonths) next.endDate = termEndDate(next.startDate, next.tenureMonths);
    onChange(next);
  };
  const toggleTeam = (id: string) =>
    onChange({ ...value, teamIds: value.teamIds.includes(id) ? value.teamIds.filter((t) => t !== id) : [...value.teamIds, id] });

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind of contract" required>
          <Select name="contractType" value={value.contractType} onChange={(e) => setTerm({ contractType: e.target.value })}>
            {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{CONTRACT_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="Tenure" required hint={permanent ? "Permanent contracts run a year and are renewed at each appraisal." : undefined}>
          <Select name="tenureMonths" disabled={permanent} value={custom ? "custom" : String(value.tenureMonths)}
            onChange={(e) => setTerm({ tenureMonths: e.target.value === "custom" ? 2 : Number(e.target.value) })}>
            {TENURES.map((t) => <option key={t.months} value={t.months}>{t.label}</option>)}
            <option value="custom">Other number of months…</option>
          </Select>
        </Field>
        {custom && !permanent && (
          <Field label="Months" required>
            <Input name="customMonths" type="number" min={1} max={36} value={value.tenureMonths}
              onChange={(e) => setTerm({ tenureMonths: Math.max(1, Math.min(36, Number(e.target.value) || 1)) })} />
          </Field>
        )}
        <Field label="Start date" required error={err(errors, "startDate")}>
          <Input name="startDate" type="date" value={value.startDate} onChange={(e) => setTerm({ startDate: e.target.value })} />
        </Field>
        <Field label="End date" required hint={`Worked out from the tenure: ${tenureLabel(value.tenureMonths)}.`} error={err(errors, "endDate")}>
          <Input name="endDate" type="date" value={value.endDate} disabled={permanent} onChange={(e) => onChange({ ...value, endDate: e.target.value })} />
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title" required error={err(errors, "jobTitle")}><Input name="jobTitle" placeholder="Marketing Intern" {...f("jobTitle")} /></Field>
        <Field label="Department">
          <Select name="departmentId" {...f("departmentId")}>
            <option value="">None</option>
            {options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Reports to" hint="Their manager. A Lead role sees the records of everyone who reports to them.">
          <Select name="reportsToUserId" {...f("reportsToUserId")}>
            <option value="">Nobody</option>
            {options.users.filter((u) => u.id !== selfUserId).map((u) => <option key={u.id} value={u.id}>{u.fullName}{u.jobTitle ? ` · ${u.jobTitle}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Hours per week"><Input name="hoursPerWeek" type="number" min={1} max={80} {...f("hoursPerWeek")} /></Field>
        <Field label="CRM role" hint="What their login can see and do. Being an intern is the contract; the role is the access, so an intern in marketing gets the Marketing role.">
          <Select name="roleId" {...f("roleId")}>
            <option value="">Choose when creating the login</option>
            {options.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold">Teams</h3>
        <p className="mb-2 text-xs text-muted-foreground">Every kind of work they take part in. Someone can be in Development, QA and Support at once.</p>
        {options.teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">No teams yet. Create them from a user&rsquo;s Teams page.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {options.teams.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="checkbox" name="teamIds" value={t.id} checked={value.teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contract: compensation
// ---------------------------------------------------------------------------

export function CompensationFields({ value, onChange, options, errors }: {
  value: TermsState; onChange: (v: TermsState) => void; options: HiringOptions; errors?: Errors;
}) {
  const f = useField(value, onChange);
  const [extra, setExtra] = useState("");
  const choices = Array.from(new Set([...options.benefits, ...value.benefits]));
  const toggle = (b: string) =>
    onChange({ ...value, benefits: value.benefits.includes(b) ? value.benefits.filter((x) => x !== b) : [...value.benefits, b] });
  const addExtra = () => {
    const b = extra.trim();
    if (b && !value.benefits.includes(b)) onChange({ ...value, benefits: [...value.benefits, b] });
    setExtra("");
  };
  const templates = options.templates.filter((t) => t.contractType === value.contractType);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 text-sm font-semibold">What they get besides pay</h3>
        <p className="mb-2 text-xs text-muted-foreground">Tick everything that applies. The list is kept under Settings › Hiring benefits.</p>
        <div className="flex flex-wrap gap-2">
          {choices.map((b) => (
            <label key={b} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="checkbox" name="benefits" value={b} checked={value.benefits.includes(b)} onChange={() => toggle(b)} />
              {b}
            </label>
          ))}
        </div>
        <div className="mt-2 flex max-w-md gap-2">
          <Input name="extraBenefit" placeholder="Something else, e.g. Laptop" value={extra} onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }} />
          <Button type="button" variant="outline" onClick={addExtra}>Add</Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Field label="Pay" required>
          <Select name="payBasis" {...f("payBasis")}>
            {PAY_BASES.map((b) => <option key={b} value={b}>{PAY_BASIS_LABELS[b]}</option>)}
          </Select>
        </Field>
        {value.payBasis !== "NONE" && (
          <>
            <Field label="Amount" required error={err(errors, "payAmount")}><Input name="payAmount" type="number" min={0} step="0.01" {...f("payAmount")} /></Field>
            <Field label="Currency" required>
              <Select name="currencyCode" {...f("currencyCode")}>
                {options.currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </>
        )}
      </section>
      <p className="text-sm text-muted-foreground">On the contract: <span className="font-medium text-foreground">{payLabel(value.payBasis, value.payAmount, value.currencyCode)}</span></p>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Notice period (days)" hint="For ending the contract early, by either side.">
          <Input name="noticeDays" type="number" min={0} max={180} value={value.noticeDays} onChange={(e) => onChange({ ...value, noticeDays: Number(e.target.value) })} />
        </Field>
        <Field label="Contract template" hint="Edit templates under People › Contract templates.">
          <Select name="templateId" {...f("templateId")}>
            <option value="">The standard one for this kind</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Other terms" hint="Printed in the contract's Other terms section.">
            <Textarea name="otherTerms" rows={3} {...f("otherTerms")} />
          </Field>
        </div>
      </section>
    </div>
  );
}
