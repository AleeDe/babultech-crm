import { PageHeader } from "@/components/ui";
import { TicketForm } from "./ticket-form";

export default function NewTicketPage() {
  return (
    <>
      <PageHeader
        backTo="/support"
        backLabel="Back to my tickets"
        title="Raise a ticket"
        description="Tell us what is wrong and it goes straight to our support team."
      />
      <TicketForm />
    </>
  );
}
