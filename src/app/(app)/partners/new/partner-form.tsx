"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, User } from "lucide-react";
import { createPartner, type PartnerInput } from "@/server/partners";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { cn, humanize } from "@/lib/utils";
import { TIER_PROTECTION_DAYS, DEAL_REGISTRATION_PROTECTION_DAYS } from "@/lib/partner-policy";

interface Options {
  users: { id: string; fullName: string }[];
  accounts: { id: string; name: string; accountType: string }[];
  contacts: { id: string; firstName: string; lastName: string; email: string | null }[];
  plans: { id: string; name: string; rateType: string; flatPercent: unknown }[];
  currencies: { code: string; name: string }[];
}

/**
 * One form, two shapes. Picking "Individual" swaps the identity block from
 * company fields to person fields — that choice is what lets a freelance
 * referrer exist without a company account behind them.
 */
export function PartnerForm({ options }: { options: Options }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"COMPANY" | "INDIVIDUAL">("COMPANY");
  const [linkExisting, setLinkExisting] = useState(false);
  const [tierValue, setTierValue] = useState("REGISTERED");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const shared = {
      partnerType: get("partnerType") as never,
      tier: get("tier") as never,
      status: get("status") as never,
      partnerManagerId: get("partnerManagerId"),
      territory: get("territory"),
      startDate: get("startDate"),
      agreementExpiryDate: get("agreementExpiryDate"),
      defaultCommissionPercent: get("defaultCommissionPercent"),
      commissionPlanId: get("commissionPlanId"),
      payoutCurrencyCode: get("payoutCurrencyCode") ?? "PKR",
      taxNumber: get("taxNumber"),
      withholdingTaxPercent: get("withholdingTaxPercent"),
      registrationProtectionDays: get("registrationProtectionDays"),
      email: get("email"),
      phone: get("phone"),
      website: get("website"),
      notes: get("notes"),
      bankDetails: {
        bankName: get("bankName") ?? undefined,
        accountTitle: get("accountTitle") ?? undefined,
        accountNumber: get("accountNumber") ?? undefined,
        iban: get("iban") ?? undefined,
      },
    };

    const input = (
      kind === "COMPANY"
        ? {
            ...shared,
            kind: "COMPANY",
            accountId: linkExisting ? get("accountId") : null,
            companyName: linkExisting ? undefined : (get("companyName") ?? undefined),
            industry: get("industry"),
            primaryContactFirstName: get("primaryContactFirstName") ?? undefined,
            primaryContactLastName: get("primaryContactLastName") ?? undefined,
            primaryContactEmail: get("primaryContactEmail") ?? undefined,
          }
        : {
            ...shared,
            kind: "INDIVIDUAL",
            contactId: linkExisting ? get("contactId") : null,
            firstName: linkExisting ? undefined : (get("firstName") ?? undefined),
            lastName: linkExisting ? undefined : (get("lastName") ?? undefined),
            mobile: get("mobile"),
            whatsapp: get("whatsapp"),
          }
    ) as unknown as PartnerInput;

    startTransition(async () => {
      const result = await createPartner(input);
      if (result.ok) {
        router.push(`/partners/${result.data.id}`);
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Who is this partner?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  value: "COMPANY" as const,
                  icon: Building2,
                  title: "A company",
                  body: "Creates (or reuses) an Account of type Partner. Use for resellers and implementation partners.",
                },
                {
                  value: "INDIVIDUAL" as const,
                  icon: User,
                  title: "An individual",
                  body: "Stored as a Contact with no company account. Use for freelance referrers and consultants.",
                },
              ]
            ).map((opt) => {
              const Icon = opt.icon;
              const selected = kind === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setKind(opt.value);
                    setLinkExisting(false);
                  }}
                  className={cn(
                    "flex gap-3 rounded-lg border p-4 text-left transition-colors",
                    selected ? "border-primary bg-primary/5" : "hover:bg-accent",
                  )}
                >
                  <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <p className="text-sm font-medium">{opt.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{opt.body}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={linkExisting}
              onChange={(e) => setLinkExisting(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Link an existing {kind === "COMPANY" ? "account" : "contact"} instead of creating a new one
          </label>

          {kind === "COMPANY" ? (
            linkExisting ? (
              <Field label="Existing account" required hint="Its type will be switched to Partner.">
                <Select name="accountId" required>
                  <option value="">Select an account…</option>
                  {options.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({humanize(a.accountType)})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company name" required error={fieldErrors.companyName?.[0]}>
                  <Input name="companyName" required placeholder="Acme Distribution (Pvt) Ltd" />
                </Field>
                <Field label="Industry">
                  <Input name="industry" placeholder="IT Services" />
                </Field>
                <Field label="Primary contact first name" hint="Optional — the person you deal with there.">
                  <Input name="primaryContactFirstName" />
                </Field>
                <Field label="Primary contact last name">
                  <Input name="primaryContactLastName" />
                </Field>
                <Field label="Primary contact email">
                  <Input name="primaryContactEmail" type="email" />
                </Field>
              </div>
            )
          ) : linkExisting ? (
            <Field label="Existing contact" required>
              <Select name="contactId" required>
                <option value="">Select a contact…</option>
                {options.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                    {c.email ? ` — ${c.email}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" required error={fieldErrors.firstName?.[0]}>
                <Input name="firstName" required />
              </Field>
              <Field label="Last name" required error={fieldErrors.lastName?.[0]}>
                <Input name="lastName" required />
              </Field>
              <Field label="Mobile">
                <Input name="mobile" placeholder="+92 300 1234567" />
              </Field>
              <Field label="WhatsApp">
                <Input name="whatsapp" />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Relationship</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Partner type" required>
            <Select name="partnerType" required defaultValue="REFERRAL">
              {["REFERRAL", "RESELLER", "IMPLEMENTATION", "TECHNOLOGY", "DISTRIBUTOR"].map((t) => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tier">
            <Select name="tier" value={tierValue} onChange={(e) => setTierValue(e.target.value)}>
              {["REGISTERED", "SILVER", "GOLD", "PLATINUM"].map((t) => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status" required>
            <Select name="status" defaultValue="PROSPECTIVE">
              {["PROSPECTIVE", "ACTIVE", "INACTIVE", "TERMINATED"].map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Partner manager" hint="Who owns this relationship internally.">
            <Select name="partnerManagerId">
              <option value="">Unassigned</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Territory">
            <Input name="territory" placeholder="Punjab / Middle East" />
          </Field>
          <Field label="Partnership start">
            <Input name="startDate" type="date" />
          </Field>
          <Field label="Agreement expiry" hint="Flagged on the list 60 days out.">
            <Input name="agreementExpiryDate" type="date" />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" />
          </Field>
          <Field label="Phone">
            <Input name="phone" />
          </Field>
          <Field label="Website">
            <Input name="website" placeholder="https://" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Commission and payment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Commission plan"
            hint="Tiered or flat rules. Takes precedence over the default rate below."
          >
            <Select name="commissionPlanId">
              <option value="">No plan — use the default rate</option>
              {options.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({humanize(p.rateType)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default commission %" hint="Fallback when no plan applies.">
            <Input name="defaultCommissionPercent" type="number" step="0.01" min="0" max="100" placeholder="10" />
          </Field>
          <Field label="Payout currency" required>
            <Select name="payoutCurrencyCode" defaultValue="PKR">
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tax number / NTN">
            <Input name="taxNumber" />
          </Field>
          <Field label="Withholding tax %" hint="Deducted automatically at payout.">
            <Input name="withholdingTaxPercent" type="number" step="0.01" min="0" max="100" placeholder="10" />
          </Field>
          <Field
            label="Deal protection (days)"
            hint={`Blank uses the tier default — ${TIER_PROTECTION_DAYS[tierValue] ?? DEAL_REGISTRATION_PROTECTION_DAYS} days for ${humanize(tierValue)}.`}
          >
            <Input name="registrationProtectionDays" type="number" min="1" max="365" />
          </Field>
          <Field label="Bank name">
            <Input name="bankName" />
          </Field>
          <Field label="Account title">
            <Input name="accountTitle" />
          </Field>
          <Field label="Account number / IBAN">
            <Input name="iban" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea name="notes" rows={4} placeholder="Anything the team should know about this partner…" />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Create partner"}
        </Button>
      </div>
    </form>
  );
}
