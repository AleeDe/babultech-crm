import type { Metadata } from "next";
import { getSigningContext } from "@/server/people";
import { contractDate } from "@/lib/people";
import { SignForm } from "./sign-form";
import { Letterhead } from "@/components/letterhead";
import { ContractText } from "@/components/contract-text";

// A signing link must never reach a search index.
export const metadata: Metadata = { title: "Sign your contract", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where a new hire reads and signs their contract, without a login. The link's
 * token is the only key; an unknown, expired or withdrawn one shows the same
 * page, which says nothing about whether it ever existed.
 */
export default async function SignContractPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getSigningContext(token);

  if (!context) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">This signing link is not valid</h1>
        <p className="mt-3 text-gray-600">It may have expired, been replaced by a newer one, or the contract may already be complete. Please contact the person who sent it to you.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <Letterhead companyName={context.companyName} className="mb-4" />
      <h1 className="mt-1 text-2xl font-semibold">{context.contractType === "Co-founder" ? "Co-founder agreement" : `${context.contractType} contract`} for {context.fullName}</h1>
      <p className="mt-2 text-gray-600">
        {context.jobTitle}, {context.endDate ? `${contractDate(context.startDate)} to ${contractDate(context.endDate)}` : `from ${contractDate(context.startDate)}`} · {context.contractNumber}
      </p>

      <article className="mt-6 rounded-xl border border-gray-200 bg-white p-6 font-serif text-[15px] leading-relaxed text-gray-900 shadow-sm">
        <ContractText body={context.body} notes={context.specialNotes} />
      </article>

      {context.status === "EMPLOYEE_SIGNED" ? (
        <div className="mt-6 rounded-xl border border-green-300 bg-green-50 p-4 text-green-900">
          <p className="font-medium">You signed this contract{context.signedName ? ` as ${context.signedName}` : ""}.</p>
          <p className="mt-1 text-sm">It is now with {context.companyName} to sign. You can print this page for your records.</p>
        </div>
      ) : (
        <SignForm token={token} fullName={context.fullName} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">{children}</div>
    </main>
  );
}
