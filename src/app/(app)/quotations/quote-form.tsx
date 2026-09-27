"use client";

import { useRouter } from "next/navigation";
import { createQuotation, updateQuotation, type QuoteFormContext } from "@/server/quotations";
import { Card, CardContent, CardHeader, CardTitle, Field } from "@/components/ui";
import { RecordLookup } from "@/components/record-lookup";
import { QuoteEditor, type QuoteDefaults } from "@/components/quote-editor";

export type { QuoteDefaults } from "@/components/quote-editor";

/**
 * Our team's quote form: the shared quote editor (components/quote-editor),
 * saved as one of our quotations. Partners prepare theirs in the portal with
 * the same editor.
 */
export function QuoteForm({
  context,
  defaults,
}: {
  context: QuoteFormContext;
  defaults?: QuoteDefaults;
}) {
  const router = useRouter();
  const { opportunity, pricing } = context;

  // Without a deal there is nothing to price: the book, the products and the
  // lines to start from all come from it. So the deal is chosen first, and the
  // page reloads around it.
  if (!opportunity || !pricing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Which deal is this quote for?</CardTitle>
        </CardHeader>
        <CardContent>
          <Field
            label="Opportunity"
            required
            help="The quote starts with everything the deal sells, and accepting it puts the quote's lines back on the deal."
          >
            <RecordLookup
              entity="opportunity"
              name="opportunityId"
              value=""
              onChange={(id) => {
                if (id) router.replace(`/quotations/new?opportunityId=${id}`);
              }}
              required
              emptyLabel="Select a deal…"
            />
          </Field>
        </CardContent>
      </Card>
    );
  }

  return (
    <QuoteEditor
      deal={opportunity}
      dealHref={`/opportunities/${opportunity.id}`}
      pricing={pricing}
      currencies={context.currencies}
      defaults={defaults}
      onSave={(values) =>
        defaults ? updateQuotation(defaults.id, values as never) : createQuotation(values as never)
      }
      onSaved={(id) => {
        router.push(`/quotations/${id}`);
        router.refresh();
      }}
    />
  );
}
