import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Card, CardContent, Alert } from "@/components/ui";
import { listNumbering } from "@/server/numbering-settings";
import { NumberingEditor } from "./numbering-editor";

/** How each kind of record is numbered: prefix, digits, year and the next number. */
export default async function NumberingPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="settings" />;
  const rows = await listNumbering();
  return (
    <>
      <PageHeader
        backTo="/settings"
        backLabel="Back to settings"
        title="Record numbering"
        description="The number each new record gets, like CASE-2026-00145. Records already numbered keep their numbers."
      />
      <div className="mb-5">
        <Alert tone="info">
          The next number can only go up, so a number is never handed out twice. Changing the prefix or the year affects new records only.
        </Alert>
      </div>
      <Card>
        <CardContent className="px-0 pt-4">
          <NumberingEditor rows={rows} />
        </CardContent>
      </Card>
    </>
  );
}
