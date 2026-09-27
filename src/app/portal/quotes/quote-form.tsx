"use client";

import { useRouter } from "next/navigation";
import {
  createPartnerQuote, updatePartnerQuote, type PartnerQuoteFormContext,
} from "@/server/partner-quotes";
import { QuoteEditor, type QuoteDefaults } from "@/components/quote-editor";

/**
 * A partner's quote: the same editor our team quotes with
 * (components/quote-editor), saved as the partner's draft for their partner
 * manager to approve.
 */
export function PartnerQuoteForm({
  context,
  defaults,
}: {
  context: PartnerQuoteFormContext;
  defaults?: QuoteDefaults;
}) {
  const router = useRouter();

  return (
    <QuoteEditor
      deal={context.deal}
      dealHref={`/portal/deals/${context.deal.id}`}
      pricing={context.pricing}
      currencies={context.currencies}
      contacts={context.contacts}
      defaults={defaults}
      termsHelp="The conditions printed on the quotation."
      onSave={(values) =>
        defaults ? updatePartnerQuote(defaults.id, values as never) : createPartnerQuote(values as never)
      }
      onSaved={(id) => router.push(`/portal/quotes/${id}`)}
    />
  );
}
