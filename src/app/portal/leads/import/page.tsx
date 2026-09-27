import { PageHeader } from "@/components/ui";
import { PartnerLeadImport } from "./import-form";

export default function ImportPortalLeadsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        backTo="/portal/leads"
        backLabel="Back to leads"
        title="Import leads"
        description="Paste from a spreadsheet or upload a CSV, then say which column is which. Anybody already in our records is left out and listed."
      />
      <PartnerLeadImport />
    </div>
  );
}
