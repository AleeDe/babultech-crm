import { notFound } from "next/navigation";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getPriceBook } from "@/server/price-books";
import { listProductsServices } from "@/server/products-services";
import { PageHeader, Forbidden, Badge } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { PriceBookEditor } from "./book-editor";

export default async function PriceBookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="price books" />;

  const { id } = await params;
  const [book, catalogue] = await Promise.all([
    getPriceBook(id),
    listProductsServices({ active: "yes" }),
  ]);
  if (!book) notFound();

  return (
    <>
      <PageHeader
        backTo="/price-books"
        backLabel="Back to price books"
        title={book.name}
        description={
          book.validFrom || book.validTo
            ? `Valid ${book.validFrom ? formatDate(book.validFrom) : "…"} to ${book.validTo ? formatDate(book.validTo) : "…"}`
            : "Open-ended"
        }
      >
        {book.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
      </PageHeader>

      <PriceBookEditor
        book={book}
        catalogue={catalogue.map((c) => ({
          id: c.id,
          name: c.name,
          productCode: c.productCode,
          productType: c.productType,
          addInTask: c.addInTask,
        }))}
        canWrite={can(me, PERMISSIONS.OPPORTUNITY_WRITE)}
      />
    </>
  );
}
