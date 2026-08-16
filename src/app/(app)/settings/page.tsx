import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Alert } from "@/components/ui";
import { getSettings } from "@/server/settings";
import { CurrencyList, TaxRateList, NamedList } from "./settings-lists";

export default async function SettingsPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="settings" />;

  const { currencies, taxRates, departments, caseCategories, expenseCategories } =
    await getSettings();

  const everythingEmpty =
    currencies.length === 0 && taxRates.length === 0 && departments.length === 0;

  return (
    <>
      <PageHeader
        title="Settings"
        description="The lists every dropdown in the app is built from. Change them here and the forms follow."
      />

      {everythingEmpty && (
        <div className="mb-6">
          <Alert tone="warning">
            All of these lists are empty. If you expected data here, the reference tables may
            not have read policies applied yet — see supabase/migrations.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <CurrencyList rows={currencies} />
        <TaxRateList rows={taxRates} />
        <NamedList
          kind="department"
          title="Departments"
          description="Used on user records and for department-scoped visibility."
          rows={departments}
        />
        <NamedList
          kind="caseCategory"
          title="Case categories"
          description="How support cases are classified."
          rows={caseCategories}
        />
        <NamedList
          kind="expenseCategory"
          title="Expense categories"
          description="Applied when recording an expense."
          rows={expenseCategories}
        />
      </div>
    </>
  );
}
