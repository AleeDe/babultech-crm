"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Field, Select } from "@/components/ui";
import { AddDealForm } from "../../customers/[id]/deal/add-deal-form";

/**
 * Choose the account, then fill in the deal.
 *
 * The list is only the accounts this partner sourced, which is the same rule
 * the write path enforces — offering one the database would refuse is how
 * somebody ends up reading "that customer is not one of yours" and assuming
 * the portal is broken.
 *
 * The form itself is the one from the account page, unchanged. Two versions of
 * a deal form would drift, and the second one to drift is always the one
 * nobody is looking at.
 */
export function PickAccountForDeal({
  accounts,
  currencies,
  dealTypes,
}: {
  accounts: { id: string; name: string; accountNumber: string }[];
  currencies: { code: string; name: string }[];
  dealTypes: { value: string; label: string }[];
}) {
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const chosen = accounts.find((a) => a.id === accountId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Which customer?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Field
            label="Account"
            required
            help="Only the customers you brought us. Add a new one from Accounts if the one you want is missing."
          >
            <Select
              id="dealAccountId"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            >
              <option value="">Choose a customer…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.accountNumber}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      {chosen && (
        <AddDealForm
          key={chosen.id}
          accountId={chosen.id}
          accountName={chosen.name}
          contacts={[]}
          currencies={currencies}
          dealTypes={dealTypes}
          hasAddress
        />
      )}
    </div>
  );
}
