import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { PaymentForm, type OpenInvoice } from "../payment-form";

export default async function NewPaymentPage() {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.PAYMENT_WRITE)) return <Forbidden what="payments" />;
  const [accounts, currencies, openInvoices] = await Promise.all([
    (async () => {
      const db = await supabaseServer();
      const { data } = await db
        .from("account")
        .select("id, name")
        .is("deletedAt", null)
        .order("name");
      return data ?? [];
    })(),
    (async () => {
      const db = await supabaseServer();
      const { data } = await db.from("currency").select("*").eq("active", true).order("code");
      return data ?? [];
    })(),
    (async () => {
      const db = await supabaseServer();
      const { data } = await db
        .from("invoice")
        .select(
          "id, accountId, invoiceNumber, invoiceDate, dueDate, totalAmount, outstandingAmount, currencyCode, status",
        )
        .is("deletedAt", null)
        .not("status", "in", '("DRAFT","CANCELLED","PAID","WRITTEN_OFF")')
        .gt("outstandingAmount", 0)
        .order("dueDate");
      return data ?? [];
    })(),
  ]);

  // Grouped so the client can swap the invoice list instantly when the
  // customer changes, without another round trip.
  const invoicesByAccount: Record<string, OpenInvoice[]> = {};
  for (const inv of serialize(openInvoices) as unknown as (OpenInvoice & { accountId: string })[]) {
    (invoicesByAccount[inv.accountId] ??= []).push(inv);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Record a payment"
        description="Apply it against open invoices as you record it. Cleared cash is what settles a balance and what most commission plans pay on."
      />
      <PaymentForm
        accounts={accounts}
        currencies={serialize(currencies)}
        invoicesByAccount={invoicesByAccount}
      />
    </div>
  );
}
