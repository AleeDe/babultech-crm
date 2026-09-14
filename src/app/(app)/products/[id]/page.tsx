import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getProductEconomics } from "@/server/crm";
import {
  PageHeader, Button, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, StatTile, DetailRow, Forbidden
} from "@/components/ui";
import { formatMoney, formatPercent, formatDate, formatNumber, humanize } from "@/lib/utils";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="the product catalogue" />;
  const db = await supabaseServer();

  // What this product cost to build against what it has earned — the question
  // the project/product link exists to answer.
  const economics = await getProductEconomics(id);

  const { data: productRow } = await db
    .from("product")
    .select(
      `*,
       defaultTaxRate:tax_rate ( * ),
       opportunityLines:opportunity_product (
         *,
         opportunity ( id, opportunityNumber, name, stage, currencyCode, account ( id, name ) )
       ),
       quoteLines:quote_line (
         *,
         quotation ( id, quoteNumber, status, currencyCode, account ( id, name ) )
       ),
       invoiceLines:invoice_line (
         *,
         invoice ( id, invoiceNumber, status, invoiceDate, currencyCode, account ( id, name ) )
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  type Row = Record<string, unknown>;

  // PostgREST returns embedded collections unordered and untrimmed, so the
  // orderBy/take from the original query are applied here.
  const withParent = (rows: unknown, key: string) =>
    ((rows as Row[] | null) ?? []).map((l): Row => {
      const parent = one(l[key] as never) as Row | null;
      return {
        ...l,
        [key]: parent ? { ...parent, account: one(parent.account as never) } : null,
      };
    });

  const product = productRow
    ? {
        ...productRow,
        defaultTaxRate: one(productRow.defaultTaxRate as never),
        opportunityLines: withParent(productRow.opportunityLines, "opportunity")
          .sort((a, b) =>
            String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
          )
          .slice(0, 25),
        quoteLines: withParent(productRow.quoteLines, "quotation").slice(0, 25),
        invoiceLines: withParent(productRow.invoiceLines, "invoice").slice(0, 25),
      }
    : null;

  if (!product) notFound();

  const price = Number(product.standardPrice ?? 0);
  const cost = Number(product.standardCost ?? 0);
  const marginPercent = price > 0 ? ((price - cost) / price) * 100 : 0;

  const pipelineValue = product.opportunityLines
    .filter((l: Record<string, any>) => !["CLOSED_WON", "CLOSED_LOST"].includes(l.opportunity?.stage))
    .reduce((s: any, l: Record<string, any>) => s + Number(l.lineTotal), 0);
  const invoicedValue = product.invoiceLines.reduce((s: any, l: Record<string, any>) => s + Number(l.lineTotal), 0);

  return (
    <>
      <PageHeader
        backTo="/products"
        backLabel="Back to products"
        title={product.name} description={`${product.productCode} · ${humanize(product.productType)}`}>
        <Badge tone={product.active ? "success" : "neutral"}>{product.active ? "Active" : "Inactive"}</Badge>
        {!product.commissionable && <Badge tone="warning">Not commissionable</Badge>}
        {can(_me, PERMISSIONS.OPPORTUNITY_WRITE) && (
          <Button asChild variant="outline">
            <Link href={`/products/${product.id}/edit`}>Edit</Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="List price" value={formatMoney(product.standardPrice)} sublabel={product.unitOfMeasure ? `per ${product.unitOfMeasure}` : undefined} />
        <StatTile
          label="Margin"
          value={price > 0 ? formatPercent(marginPercent, 1) : "—"}
          sublabel={`Cost ${formatMoney(product.standardCost)}`}
          tone={marginPercent >= 30 ? "success" : marginPercent > 0 ? "warning" : "neutral"}
        />
        <StatTile label="In open pipeline" value={formatMoney(pipelineValue)} sublabel={`${product.opportunityLines.length} deal line(s)`} tone="info" />
        <StatTile label="Invoiced" value={formatMoney(invoicedValue)} sublabel={`${product.invoiceLines.length} invoice line(s)`} />
      </div>

      {/* ------------------------------------------- what it cost vs earned */}
      {economics && (
        <section className="mt-6">
          <h2 className="mb-1 text-sm font-semibold">Build and return</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Cost is every hour logged to a project linked to this product, at the
            rates stamped on each entry. Revenue is every invoice line carrying
            it. A product still in development shows cost and no revenue — that
            is an investment that has not paid back yet, not an error.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Cost to build"
              value={formatMoney(economics.investment.cost)}
              sublabel={`${formatNumber(economics.investment.hours, 1)}h across ${economics.investment.projects} project${economics.investment.projects === 1 ? "" : "s"}`}
              help="Every hour logged to a project linked to this product, valued at the cost rate stamped on each entry."
            />
            <StatTile
              label="Revenue"
              value={formatMoney(economics.earnings.revenue)}
              sublabel={
                economics.earnings.customers > 0
                  ? `${economics.earnings.customers} customer${economics.earnings.customers === 1 ? "" : "s"}`
                  : "Not sold yet"
              }
              help="Invoice lines carrying this product. Cancelled invoices are excluded."
            />
            <StatTile
              label={economics.margin >= 0 ? "Net return" : "Still invested"}
              value={formatMoney(Math.abs(economics.margin))}
              sublabel={
                economics.marginPercent === null
                  ? "No revenue to measure against"
                  : `${formatNumber(economics.marginPercent, 1)}% margin`
              }
              tone={economics.hasPaidBack ? "success" : economics.margin < 0 ? "warning" : "neutral"}
              help="Revenue less what it cost to build. Negative while the product has yet to earn back its build cost."
            />
            <StatTile
              label="Collected"
              value={formatMoney(economics.earnings.collected)}
              sublabel={
                economics.earnings.outstanding > 0
                  ? `${formatMoney(economics.earnings.outstanding)} still owed`
                  : "Nothing outstanding"
              }
              help="Money actually received, from invoices marked paid. The rest is billed but not yet in the bank."
            />
          </div>

          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Where the work happened</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {economics.byProject.length === 0 ? (
                  <p className="px-5 pb-2 text-sm text-muted-foreground">
                    No project is linked to this product yet. Open a project and set
                    its Product field to start tracking what this costs to build.
                  </p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Project</TH>
                        <TH priority="tertiary">Type</TH>
                        <TH className="text-right" priority="secondary">Hours</TH>
                        <TH className="text-right">Cost</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {economics.byProject.map((p) => (
                        <TR key={p.id}>
                          <TD>
                            <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                              {p.name}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {p.projectNumber}
                              {p.accountName && ` · ${p.accountName}`}
                              {` · ${p.completionPercent}% done`}
                            </p>
                          </TD>
                          <TD priority="tertiary">
                            <Badge tone={p.projectType === "INTERNAL" ? "neutral" : "info"}>
                              {p.projectType === "INTERNAL" ? "Own build" : "Customer"}
                            </Badge>
                          </TD>
                          <TD className="text-right tabular" priority="secondary">
                            {formatNumber(p.hours, 1)}
                          </TD>
                          <TD className="text-right tabular">{formatMoney(p.cost)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Who bought it</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {economics.byCustomer.length === 0 ? (
                  <p className="px-5 pb-2 text-sm text-muted-foreground">
                    Not invoiced to anyone yet. Once this product appears on an
                    invoice line, the customers show here against what they paid.
                  </p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Customer</TH>
                        <TH className="text-right" priority="tertiary">Lines</TH>
                        <TH className="text-right">Revenue</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {economics.byCustomer.map((c) => (
                        <TR key={c.id}>
                          <TD>
                            <Link href={`/accounts/${c.id}`} className="font-medium hover:underline">
                              {c.name}
                            </Link>
                          </TD>
                          <TD className="text-right tabular" priority="tertiary">{c.invoices}</TD>
                          <TD className="text-right tabular">{formatMoney(c.revenue)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>On opportunities</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {product.opportunityLines.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">Not on any deal yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Deal</TH>
                      <TH>Customer</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Line total</TH>
                      <TH>Stage</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {product.opportunityLines.map((l: Record<string, any>) => (
                      <TR key={l.id}>
                        <TD>
                          <Link href={`/opportunities/${l.opportunity?.id}`} className="font-medium hover:underline">
                            {l.opportunity?.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">{l.opportunity?.opportunityNumber}</p>
                        </TD>
                        <TD className="text-sm">
                          <Link href={`/accounts/${l.opportunity?.account?.id}`} className="hover:underline">
                            {l.opportunity?.account?.name}
                          </Link>
                        </TD>
                        <TD className="text-right tabular">{formatNumber(l.quantity, 2)}</TD>
                        <TD className="text-right tabular">{formatMoney(l.lineTotal, l.opportunity?.currencyCode)}</TD>
                        <TD><Badge tone={statusTone(l.opportunity?.stage)}>{humanize(l.opportunity?.stage)}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>On quotes and invoices</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {product.quoteLines.length === 0 && product.invoiceLines.length === 0 ? (
                <p className="px-5 pb-2 text-sm text-muted-foreground">Never quoted or invoiced.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Document</TH>
                      <TH>Customer</TH>
                      <TH className="text-right">Line total</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {product.quoteLines.map((l: Record<string, any>) => (
                      <TR key={l.id}>
                        <TD>
                          <Link href={`/quotations/${l.quotation?.id}`} className="font-medium hover:underline">
                            {l.quotation?.quoteNumber}
                          </Link>
                          <p className="text-xs text-muted-foreground">Quotation</p>
                        </TD>
                        <TD className="text-sm">
                          <Link href={`/accounts/${l.quotation?.account?.id}`} className="hover:underline">
                            {l.quotation?.account?.name}
                          </Link>
                        </TD>
                        <TD className="text-right tabular">{formatMoney(l.lineTotal, l.quotation?.currencyCode)}</TD>
                        <TD><Badge tone={statusTone(l.quotation?.status)}>{humanize(l.quotation?.status)}</Badge></TD>
                      </TR>
                    ))}
                    {product.invoiceLines.map((l: Record<string, any>) => (
                      <TR key={l.id}>
                        <TD>
                          <Link href={`/invoices/${l.invoice?.id}`} className="font-medium hover:underline">
                            {l.invoice?.invoiceNumber}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            Invoice · {formatDate(l.invoice?.invoiceDate)}
                          </p>
                        </TD>
                        <TD className="text-sm">
                          <Link href={`/accounts/${l.invoice?.account?.id}`} className="hover:underline">
                            {l.invoice?.account?.name}
                          </Link>
                        </TD>
                        <TD className="text-right tabular">{formatMoney(l.lineTotal, l.invoice?.currencyCode)}</TD>
                        <TD><Badge tone={statusTone(l.invoice?.status)}>{humanize(l.invoice?.status)}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Code">{product.productCode}</DetailRow>
              <DetailRow label="Category">{product.category ?? "—"}</DetailRow>
              <DetailRow label="Type">{humanize(product.productType)}</DetailRow>
              <DetailRow label="Billing">{humanize(product.billingType)}</DetailRow>
              <DetailRow label="Unit of measure">{product.unitOfMeasure ?? "—"}</DetailRow>
              <DetailRow label="Default tax">
                {product.defaultTaxRate
                  ? `${product.defaultTaxRate?.name} (${formatPercent(product.defaultTaxRate?.ratePercent, 1)})`
                  : "None"}
              </DetailRow>
              <DetailRow label="Commission">
                {product.commissionable
                  ? product.commissionPercent
                    ? `${formatPercent(product.commissionPercent, 2)} override`
                    : "Uses the partner's plan"
                  : "Excluded from commission"}
              </DetailRow>
            </CardContent>
          </Card>

          {product.description && (
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{product.description}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
