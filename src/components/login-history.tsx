import Link from "next/link";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import type { LoginEventRow } from "@/server/security";

const LABEL: Record<string, { text: string; tone: "success" | "danger" | "neutral" | "warning" | "info" }> = {
  SIGN_IN: { text: "Signed in", tone: "success" },
  SIGN_IN_FAILED: { text: "Failed sign-in", tone: "danger" },
  SIGN_OUT: { text: "Signed out", tone: "neutral" },
  VIEW_AS_START: { text: "View as started", tone: "warning" },
  VIEW_AS_END: { text: "View as ended", tone: "info" },
};

/** A browser's name from its user agent: enough to recognise, no more. */
function browser(ua: string | null): string {
  if (!ua) return "—";
  const name = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${name} on ${os}` : name;
}

export function LoginHistory({
  title = "Sign-in history",
  events,
  showUser = false,
}: {
  title?: string;
  events: LoginEventRow[];
  showUser?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {events.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        </CardContent>
      ) : (
        <CardContent className="px-0">
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                {showUser && <TH>Who</TH>}
                <TH>What</TH>
                <TH priority="secondary">From</TH>
                <TH priority="secondary">Browser</TH>
              </TR>
            </THead>
            <TBody>
              {events.map((e) => {
                const label = LABEL[e.eventType] ?? { text: e.eventType, tone: "neutral" as const };
                return (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap text-sm">{formatDateTime(e.createdAt)}</TD>
                    {showUser && (
                      <TD className="text-sm">
                        {e.userId ? <Link href={`/users/${e.userId}`} className="hover:underline">{e.userName ?? e.email}</Link> : e.email ?? "—"}
                      </TD>
                    )}
                    <TD className="text-sm">
                      <Badge tone={label.tone}>{label.text}</Badge>
                      {e.targetName && (
                        <span className="ml-1.5">
                          as <Link href={`/users/${e.targetUserId}`} className="hover:underline">{e.targetName}</Link>
                        </span>
                      )}
                      {(e.reason || e.detail) && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{e.reason ? `Reason: ${e.reason}` : e.detail}</p>
                      )}
                    </TD>
                    <TD className="text-sm" priority="secondary">{e.ip ?? "—"}</TD>
                    <TD className="text-sm" priority="secondary">{browser(e.userAgent)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
