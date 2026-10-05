import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Printer } from "lucide-react";
import { requireUser } from "@/lib/authz";
import { PageHeader, Button, Card, CardHeader, CardTitle, CardContent, DetailRow, Badge, Alert } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { listDocuments } from "@/server/documents";
import { getContract } from "@/server/people";
import {
  CONTRACT_TYPE_LABELS, CONTRACT_STATUS_LABELS, contractTone, payLabel, tenureLabel, contractDate, daysUntil,
  type ContractStatus, type ContractType,
} from "@/lib/people";
import { formatDateTime, cn } from "@/lib/utils";
import { ContractActions, ContractTextEditor } from "./contract-actions";

const STAGES = [
  { label: "Prepared", done: ["SENT", "EMPLOYEE_SIGNED", "SIGNED", "ACTIVE", "ENDED", "RENEWED", "CONVERTED", "TERMINATED", "RESIGNED"] },
  { label: "Signed by them", done: ["EMPLOYEE_SIGNED", "SIGNED", "ACTIVE", "ENDED", "RENEWED", "CONVERTED", "TERMINATED", "RESIGNED"] },
  { label: "Signed by the company", done: ["SIGNED", "ACTIVE", "ENDED", "RENEWED", "CONVERTED", "TERMINATED", "RESIGNED"] },
  { label: "Started", done: ["ACTIVE", "ENDED", "RENEWED", "CONVERTED", "TERMINATED", "RESIGNED"] },
];

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  await requireUser();
  const { id } = await params;
  const { new: justCreated } = await searchParams;
  const data = await getContract(id);
  if (!data) notFound();
  const { contract: c, canWrite, canCreateLogins } = data;
  const documents = await listDocuments("EmploymentContract", id);
  const status = c.status as ContractStatus;
  const left = status === "ACTIVE" ? daysUntil(c.endDate) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`${CONTRACT_TYPE_LABELS[c.contractType as ContractType]} · ${c.staff.fullName}`}
        description={`${c.contractNumber} · ${c.jobTitle}`}
        backTo={`/people/${c.staff.id}`}
        backLabel={c.staff.fullName}
      >
        <Badge tone={contractTone(status)}>{CONTRACT_STATUS_LABELS[status]}</Badge>
        <Button asChild variant="outline"><Link href={`/print/contracts/${id}`} target="_blank"><Printer className="h-4 w-4" /> Print</Link></Button>
        {canWrite && status === "DRAFT" && <Button asChild variant="outline"><Link href={`/people/contracts/${id}/edit`}>Edit terms</Link></Button>}
      </PageHeader>

      {justCreated && (
        <div className="mb-6"><Alert tone="success">
          Saved. Read through the contract below and adjust the wording if needed, then send it for signing or print it to sign by hand.
          {canCreateLogins && !c.staff.userId ? " Their login can be created from their profile page." : ""}
        </Alert></div>
      )}

      {!["CANCELLED"].includes(status) && (
        <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STAGES.map((s) => {
            const done = s.done.includes(status);
            return (
              <li key={s.label} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", done ? "border-primary/40 bg-primary/5" : "text-muted-foreground")}>
                <span className={cn("grid h-5 w-5 place-items-center rounded-full border", done && "border-primary bg-primary text-primary-foreground")}>{done && <Check className="h-3 w-3" />}</span>
                {s.label}
              </li>
            );
          })}
        </ol>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>The contract</CardTitle></CardHeader>
            <CardContent>
              {canWrite && status === "DRAFT" ? (
                <ContractTextEditor contractId={id} body={c.body} />
              ) : (
                <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-4 font-serif text-sm leading-relaxed" data-contract-text>{c.body}</div>
              )}
              {(c.employeeSignature || c.companySignature || c.signMethod === "MANUAL") && (
                <div className="mt-6 grid gap-6 sm:grid-cols-2">
                  <Signature label={`Signed by ${c.staff.fullName}`} image={c.employeeSignature} name={c.employeeSignedName} at={c.employeeSignedAt} manual={c.signMethod === "MANUAL"} />
                  <Signature label="Signed for the company" image={c.companySignature} name={c.companySignedName} at={c.companySignedAt} manual={c.signMethod === "MANUAL"} />
                </div>
              )}
              {c.bodyHash && <p className="mt-4 break-all text-xs text-muted-foreground">Fingerprint of the text as sent: {c.bodyHash}</p>}
            </CardContent>
          </Card>
          <DocumentsPanel entityType="EmploymentContract" entityId={id} documents={documents} />
        </div>

        <div className="space-y-6">
          {canWrite && <ContractActions contract={{
            id, status, contractNumber: c.contractNumber, startDate: c.startDate, endDate: c.endDate,
            personalEmail: c.staff.personalEmail, staffId: c.staff.id, signTokenExpiresAt: c.signTokenExpiresAt,
            hasSuccessor: c.successors.length > 0,
          }} />}

          <Card>
            <CardHeader><CardTitle>Terms</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Kind">{CONTRACT_TYPE_LABELS[c.contractType as ContractType]}, {tenureLabel(c.tenureMonths)}</DetailRow>
              <DetailRow label="Dates">{contractDate(c.startDate)} to {contractDate(c.endDate)}</DetailRow>
              {left != null && <DetailRow label="Ends in">{left === 0 ? "Today" : `${left} day${left === 1 ? "" : "s"}`}</DetailRow>}
              <DetailRow label="Job title">{c.jobTitle}</DetailRow>
              <DetailRow label="Department">{c.department?.name ?? "—"}</DetailRow>
              <DetailRow label="Reports to">{c.reportsTo?.fullName ?? "—"}</DetailRow>
              <DetailRow label="CRM role">{c.role?.name ?? "—"}</DetailRow>
              <DetailRow label="Teams">{c.teams.map((t) => t.name).join(", ") || "—"}</DetailRow>
              <DetailRow label="Hours a week">{c.hoursPerWeek ?? "—"}</DetailRow>
              <DetailRow label="Pay">{payLabel(c.payBasis, c.payAmount, c.currencyCode)}</DetailRow>
              <DetailRow label="Benefits">{c.benefits.join(", ") || "—"}</DetailRow>
              <DetailRow label="Notice">{c.noticeDays} days</DetailRow>
              {c.signedOn && <DetailRow label="Signed">{contractDate(c.signedOn)}{c.signMethod === "MANUAL" ? " (by hand)" : " (digitally)"}</DetailRow>}
              {c.lastWorkingDay && <DetailRow label="Last working day">{contractDate(c.lastWorkingDay)}</DetailRow>}
              {c.noticeGivenOn ? <DetailRow label="Notice given">{contractDate(String(c.noticeGivenOn))}</DetailRow> : null}
              {c.endReason ? <DetailRow label="Reason">{String(c.endReason)}</DetailRow> : null}
              {c.previous && <DetailRow label="Follows"><Link className="text-primary hover:underline" href={`/people/contracts/${c.previous.id}`}>{c.previous.contractNumber}</Link></DetailRow>}
              {c.successors.map((s) => (
                <DetailRow key={s.id} label="Followed by"><Link className="text-primary hover:underline" href={`/people/contracts/${s.id}`}>{s.contractNumber}</Link> ({CONTRACT_STATUS_LABELS[s.status as ContractStatus].toLowerCase()})</DetailRow>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Signature({ label, image, name, at, manual }: { label: string; image: string | null; name: string | null; at: string | null; manual: boolean }) {
  return (
    <div className="text-sm">
      <p className="mb-1 text-muted-foreground">{label}</p>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={`Signature of ${name ?? "the signer"}`} className="h-20 rounded border bg-white p-1" />
      ) : (
        <div className="grid h-20 place-items-center rounded border border-dashed text-xs text-muted-foreground">{manual ? "On the paper copy" : "Not yet"}</div>
      )}
      {name && <p className="mt-1 font-medium">{name}</p>}
      {at && <p className="text-xs text-muted-foreground">{formatDateTime(`${at}Z`)}</p>}
    </div>
  );
}
