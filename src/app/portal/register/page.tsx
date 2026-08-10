import { getPartnerProfile } from "@/server/portal";
import { PageHeader, Alert } from "@/components/ui";
import { formatDate, humanize } from "@/lib/utils";
import { RegisterForm } from "./register-form";

export default async function RegisterDealPage() {
  const partner = await getPartnerProfile();

  const expired =
    partner.agreementExpiryDate !== null && partner.agreementExpiryDate < new Date();
  const blocked = partner.status !== "ACTIVE" || expired;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Register a deal"
        description="Tell us about a customer you are working so the deal is credited to you."
      />

      {blocked ? (
        <Alert tone="danger">
          {partner.status !== "ACTIVE"
            ? `Your partnership is currently ${humanize(partner.status).toLowerCase()}, so registrations cannot be accepted.`
            : `Your partner agreement expired on ${formatDate(partner.agreementExpiryDate)}, so registrations cannot be accepted.`}{" "}
          Please speak to your partner manager.
        </Alert>
      ) : (
        <RegisterForm />
      )}
    </div>
  );
}
