"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Alert, Button, Card, CardContent, DetailRow, Field, Select } from "@/components/ui";
import { createHire, type HiringOptions } from "@/server/people";
import { CONTRACT_TYPE_LABELS, payLabel, tenureLabel, contractDate, type ContractType } from "@/lib/people";
import { cn } from "@/lib/utils";
import { PersonalFields, BackgroundFields, PositionFields, CompensationFields } from "../person-forms";
import { EMPTY_PROFILE, emptyTerms, termsInput, type ProfileState, type TermsState } from "@/lib/people-forms";

const STEPS = [
  { key: "personal", label: "Personal details" },
  { key: "background", label: "Education & experience" },
  { key: "position", label: "Position & term" },
  { key: "pay", label: "Compensation" },
  { key: "review", label: "Review" },
] as const;

/**
 * Hiring, one step at a time. Nothing is saved until the last step, which
 * creates the profile and a draft contract and opens the contract, where it is
 * signed and the login created.
 */
export function HireWizard({ options }: { options: HiringOptions }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<ProfileState>(EMPTY_PROFILE);
  const [terms, setTerms] = useState<TermsState>(() => emptyTerms(options.currencies[0] ?? "PKR"));
  const [existingUserId, setExistingUserId] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The checks each step can make before moving on; the server checks it all again.
  function problem(at: number): string | null {
    if (at === 0) {
      if (!profile.fullName.trim()) return "Enter their name.";
      for (const k of ["linkedinUrl", "githubUrl", "portfolioUrl"] as const) {
        if (profile[k] && !/^https?:\/\/\S+$/.test(profile[k])) return "Enter online profiles as full addresses, starting https://";
      }
    }
    if (at === 1) {
      if (profile.education.some((e) => !e.degree.trim() || !e.institution.trim())) return "Each education needs a degree and an institution, or remove it.";
      if (profile.experience.some((e) => !e.company.trim() || !e.title.trim())) return "Each experience needs a company and a position, or remove it.";
    }
    if (at === 2) {
      if (!terms.jobTitle.trim()) return "Enter the job title.";
      if (!terms.startDate || !terms.endDate) return "Choose the start date.";
      if (terms.endDate < terms.startDate) return "The end date is before the start date.";
    }
    if (at === 3 && terms.payBasis !== "NONE" && !terms.payAmount) return "Enter the pay amount, or choose No pay.";
    return null;
  }

  function go(to: number) {
    if (to > step) {
      for (let i = step; i < to; i++) {
        const p = problem(i);
        if (p) { setError(p); setStep(i); return; }
      }
    }
    setError(null);
    setStep(to);
    window.scrollTo({ top: 0 });
  }

  function save() {
    setError(null);
    start(async () => {
      const result = await createHire({ profile, terms: termsInput(terms) as never, userId: existingUserId || null });
      if (!result.ok) {
        setError(result.error);
        setErrors(result.fieldErrors);
        return;
      }
      window.location.href = `/people/contracts/${result.data.contractId}?new=1`;
    });
  }

  const dept = options.departments.find((d) => d.id === terms.departmentId)?.name;
  const manager = options.users.find((u) => u.id === terms.reportsToUserId)?.fullName;
  const role = options.roles.find((r) => r.id === terms.roleId)?.name;
  const teams = options.teams.filter((t) => terms.teamIds.includes(t.id)).map((t) => t.name);

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button type="button" onClick={() => go(i)} aria-current={i === step ? "step" : undefined}
              className={cn("flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm",
                i === step ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground hover:bg-muted")}>
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs", i < step && "border-primary bg-primary text-primary-foreground")}>
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>

      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardContent className="p-6">
          <h2 className="mb-1 text-lg font-semibold">{STEPS[step].label}</h2>
          {step === 0 && (
            <>
              <p className="mb-5 text-sm text-muted-foreground">Who they are. Only the name is needed now; the rest can be filled in later.</p>
              {options.canCreateLogins && options.users.length > 0 && (
                <div className="mb-6 max-w-md">
                  <Field label="Already works here with a login?" hint="Choose them to give an existing colleague a profile and contract. Leave empty for a new hire.">
                    <Select name="existingUserId" value={existingUserId} onChange={(e) => {
                      setExistingUserId(e.target.value);
                      const u = options.users.find((x) => x.id === e.target.value);
                      if (u && !profile.fullName) setProfile({ ...profile, fullName: u.fullName });
                    }}>
                      <option value="">No, a new hire</option>
                      {options.users.map((u) => <option key={u.id} value={u.id}>{u.fullName} · {u.email}</option>)}
                    </Select>
                  </Field>
                </div>
              )}
              <PersonalFields value={profile} onChange={setProfile} errors={errors} />
            </>
          )}
          {step === 1 && (
            <>
              <p className="mb-5 text-sm text-muted-foreground">Their academic and professional background, from their CV or LinkedIn. All optional.</p>
              <BackgroundFields value={profile} onChange={setProfile} errors={errors} />
            </>
          )}
          {step === 2 && (
            <>
              <p className="mb-5 text-sm text-muted-foreground">The job, how long the contract runs, and how they fit in.</p>
              <PositionFields value={terms} onChange={setTerms} options={options} errors={errors} selfUserId={existingUserId || null} />
            </>
          )}
          {step === 3 && (
            <>
              <p className="mb-5 text-sm text-muted-foreground">What they get: benefits, pay, or both, or neither.</p>
              <CompensationFields value={terms} onChange={setTerms} options={options} errors={errors} />
            </>
          )}
          {step === 4 && (
            <div className="grid gap-6 text-sm md:grid-cols-2">
              <div className="space-y-2">
                <h3 className="font-semibold">{profile.fullName || "—"}</h3>
                <DetailRow label="CNIC">{profile.nationalId || "—"}</DetailRow>
                <DetailRow label="Personal email">{profile.personalEmail || "—"}</DetailRow>
                <DetailRow label="Phone">{profile.phone || "—"}</DetailRow>
                <DetailRow label="Education">{profile.education.length ? profile.education.map((e) => e.degree).join(", ") : "—"}</DetailRow>
                <DetailRow label="Experience">{profile.experience.length ? `${profile.experience.length} position(s)` : "—"}</DetailRow>
                <DetailRow label="Skills">{profile.skills.join(", ") || "—"}</DetailRow>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold">{CONTRACT_TYPE_LABELS[terms.contractType as ContractType]}, {tenureLabel(terms.tenureMonths)}</h3>
                <DetailRow label="Dates">{contractDate(terms.startDate)} to {contractDate(terms.endDate)}</DetailRow>
                <DetailRow label="Job title">{terms.jobTitle}</DetailRow>
                <DetailRow label="Department">{dept ?? "—"}</DetailRow>
                <DetailRow label="Reports to">{manager ?? "—"}</DetailRow>
                <DetailRow label="CRM role">{role ?? "Chosen when the login is created"}</DetailRow>
                <DetailRow label="Teams">{teams.join(", ") || "—"}</DetailRow>
                <DetailRow label="Pay">{payLabel(terms.payBasis, terms.payAmount, terms.currencyCode)}</DetailRow>
                <DetailRow label="Benefits">{terms.benefits.join(", ") || "—"}</DetailRow>
              </div>
              <p className="text-muted-foreground md:col-span-2">
                Saving creates their profile and a draft contract from the template. Next you can adjust the
                wording, print it or send it for digital signing, and create their login.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button type="button" variant="outline" disabled={step === 0 || pending} onClick={() => go(step - 1)}>Back</Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={() => go(step + 1)}>Next</Button>
        ) : (
          <Button type="button" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save and prepare contract"}</Button>
        )}
      </div>
    </div>
  );
}
