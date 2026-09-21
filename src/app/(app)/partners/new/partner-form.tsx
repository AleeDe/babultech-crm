"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, User } from "lucide-react";
import { createPartner, type PartnerInput } from "@/server/partners";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import { RecordLookup } from "@/components/record-lookup";
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
  const [tierValue, setTierValue] = useState("SILVER");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // A submit HANDLER rather than <form action={...}>. React resets a form after
  // an action completes, and every field here is uncontrolled (defaultValue), so
  // with `action` a rejected submit cleared everything the user had typed and
  // made them fill the whole form in again to correct one field.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

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
    <form onSubmit={onSubmit} className="space-y-6">
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
              <Field label="Existing account" required hint="Its type will be switched to Partner."
            help="Pick this if they are already in the system as an account, so you do not end up with two records for one company.">
                <RecordLookup
                  entity="account"
                  name="accountId"
                  required
                  filters={{ accountType: "PARTNER" }}
                  emptyLabel="Search partner accounts…"
                />
              </Field>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Company name" required error={fieldErrors.companyName?.[0]}
            help="The partner organisation's registered name.">
                  <Input name="companyName" required placeholder="Acme Distribution (Pvt) Ltd" />
                </Field>
                <Field label="Industry"
            help="The sector they specialise in.">
                  <Input name="industry" placeholder="IT Services" />
                </Field>
                <Field label="Primary contact first name" hint="Optional - the person you deal with there."
            help="Given name of your main point of contact there.">
                  <Input name="primaryContactFirstName" />
                </Field>
                <Field label="Primary contact last name"
            help="Family name of your main point of contact.">
                  <Input name="primaryContactLastName" />
                </Field>
                <Field label="Primary contact email"
            help="Their email. This is also the address they use to sign in to the partner portal.">
                  <Input name="primaryContactEmail" type="email" />
                </Field>
              </div>
            )
          ) : linkExisting ? (
            <Field label="Existing contact" required
            help="Pick this if their main contact is already in the system.">
              <RecordLookup entity="contact" name="contactId" required emptyLabel="Select a contact…" />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" required error={fieldErrors.firstName?.[0]}
            help="Given name of the person who signs in to the partner portal.">
                <Input name="firstName" required />
              </Field>
              <Field label="Last name" required error={fieldErrors.lastName?.[0]}
            help="Family name of the portal user.">
                <Input name="lastName" required />
              </Field>
              <Field label="Mobile"
            help="Their direct mobile.">
                <Input name="mobile" placeholder="+92 300 1234567" />
              </Field>
              <Field label="WhatsApp"
            help="Only if it differs from the mobile above.">
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
          <Field label="Partner type" required
            help="What they do for you: send referrals, hold the account, deliver the work, or put money in.">
            <Select name="partnerType" required defaultValue="REFERRAL">
              {["REFERRAL", "ACCOUNT_MANAGEMENT", "IMPLEMENTATION", "INVESTMENT"].map((t) => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tier"
            help="Their level in your partner programme. Often drives the commission rate.">
            <Select name="tier" value={tierValue} onChange={(e) => setTierValue(e.target.value)}>
              {["SILVER", "GOLD", "PLATINUM"].map((t) => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status" required
            help="Only an active partnership can register deals, add customers or use the portal. Inactive keeps the history without the entitlements.">
            <Select name="status" defaultValue="INACTIVE">
              {["ACTIVE", "INACTIVE", "TERMINATED"].map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Partner manager" hint="Who owns this relationship internally."
            help="Whoever owns this relationship on your side.">
            <RecordLookup entity="user" name="partnerManagerId" emptyLabel="Unassigned" />
          </Field>
          <Field label="Territory"
            help="The region they are allowed to sell in. Prevents two partners chasing the same customer.">
            <Input name="territory" placeholder="Punjab / Middle East" />
          </Field>
          <Field label="Partnership start"
            help="When the agreement began.">
            <Input name="startDate" type="date" />
          </Field>
          <Field label="Agreement expiry" hint="Flagged on the list 60 days out."
            help="When it needs renewing.">
            <Input name="agreementExpiryDate" type="date" />
          </Field>
          <Field label="Email"
            help="The email this person signs in with.">
            <Input name="email" type="email" />
          </Field>
          <Field label="Phone"
            help="A contact number for them.">
            <Input name="phone" />
          </Field>
          <Field label="Website"
            help="Their public site.">
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
            help="The plan that decides how much they earn. Set the plans up first under Commissions."
          >
            <Select name="commissionPlanId">
              <option value="">No plan - use the default rate</option>
              {options.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({humanize(p.rateType)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default commission %" hint="Fallback when no plan applies."
            help="The rate applied when no plan covers a particular deal.">
            <Input name="defaultCommissionPercent" type="number" step="0.01" min="0" max="100" placeholder="10" />
          </Field>
          <Field label="Payout currency" required
            help="The currency they are paid in, which is not always the currency of the deal.">
            <Select name="payoutCurrencyCode" defaultValue="PKR">
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tax number / NTN"
            help="Their National Tax Number. Needed before you can pay them.">
            <Input name="taxNumber" />
          </Field>
          <Field label="Withholding tax %" hint="Deducted automatically at payout."
            help="Tax deducted at source before paying them. Set it here and payouts calculate net automatically.">
            <Input name="withholdingTaxPercent" type="number" step="0.01" min="0" max="100" placeholder="10" />
          </Field>
          <Field
            label="Deal protection (days)"
            hint={`Blank uses the tier default, ${TIER_PROTECTION_DAYS[tierValue] ?? DEAL_REGISTRATION_PROTECTION_DAYS} days for ${humanize(tierValue)}.`}
            help="How long a partner keeps exclusive claim to a deal they registered. Stops a second partner or your own team registering the same customer behind them."
          >
            <Input name="registrationProtectionDays" type="number" min="1" max="365" />
          </Field>
          <Field label="Bank name"
            help="The bank their payouts go to.">
            <Input name="bankName" />
          </Field>
          <Field label="Account title"
            help="The account holder's name exactly as the bank has it. A mismatch is the usual reason a transfer bounces.">
            <Input name="accountTitle" />
          </Field>
          <Field label="Account number / IBAN"
            help="The account number or IBAN for payouts.">
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
