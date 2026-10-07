import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { getContract } from "@/server/people";
import { contractDate } from "@/lib/people";
import { withTitle } from "@/lib/utils";
import { Letterhead } from "@/components/letterhead";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Contract", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A contract on its own, for printing or saving as PDF from the browser. Same
 * access as the contract page: people:read, or the person it is for.
 */
export default async function PrintContractPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
  } catch {
    redirect("/login");
  }
  const { id } = await params;
  const data = await getContract(id);
  if (!data) notFound();
  const c = data.contract;

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-[800px] px-8 py-10 print:p-0">
        <div className="mb-6 flex justify-end print:hidden"><PrintButton /></div>
        <Letterhead companyName={c.companyName} className="mb-8 border-b border-gray-300 pb-4" />
        <article className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed" data-contract-text>{c.body}</article>
        <div className="mt-16 grid grid-cols-2 gap-16 text-sm" style={{ breakInside: "avoid" }}>
          <SignatureBlock label={`For ${c.companyName}`} image={c.companySignature} name={c.companySignedName ? withTitle(c.companySignedName, c.companySignedTitle) : null} date={c.companySignedAt?.slice(0, 10) ?? null} />
          <SignatureBlock label={withTitle(c.staff.fullName, c.jobTitle)} image={c.employeeSignature} name={c.employeeSignedName ? withTitle(c.employeeSignedName, c.jobTitle) : null} date={c.employeeSignedAt?.slice(0, 10) ?? null} />
        </div>
        {c.bodyHash && <p className="mt-10 break-all text-[10px] text-gray-400">{c.contractNumber} · text fingerprint {c.bodyHash}</p>}
      </div>
    </main>
  );
}

function SignatureBlock({ label, image, name, date }: { label: string; image: string | null; name: string | null; date: string | null }) {
  return (
    <div>
      <div className="flex h-24 items-end border-b border-gray-400">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt="" className="max-h-24" />}
      </div>
      <p className="mt-2 font-medium">{name ?? label}</p>
      <p className="text-gray-500">{label}</p>
      <p className="mt-4 text-gray-500">Date: {date ? contractDate(date) : "________________"}</p>
    </div>
  );
}
