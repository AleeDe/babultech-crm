"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Card, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { NOTIFICATION_KINDS } from "@/lib/notification-kinds";
import { saveNotificationPreferences, type PreferenceRow } from "@/server/notifications";

export function PreferencesForm({ preferences }: { preferences: PreferenceRow[] }) {
  const [rows, setRows] = useState(preferences);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const set = (kind: string, field: "inApp" | "email", value: boolean) =>
    setRows((list) => list.map((r) => (r.kind === kind ? { ...r, [field]: value } : r)));

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveNotificationPreferences(rows);
      setMessage(result.ok ? { tone: "success", text: "Saved." } : { tone: "danger", text: result.error });
    });
  }

  return (
    <Card>
      {message && <div className="p-4 pb-0"><Alert tone={message.tone}>{message.text}</Alert></div>}
      <Table>
        <THead>
          <TR>
            <TH>Notification</TH>
            <TH className="w-24 text-center">Bell</TH>
            <TH className="w-24 text-center">Email</TH>
          </TR>
        </THead>
        <TBody>
          {NOTIFICATION_KINDS.map((k) => {
            const row = rows.find((r) => r.kind === k.kind)!;
            const emailFixed = "emailFixed" in k && k.emailFixed;
            return (
              <TR key={k.kind}>
                <TD>
                  <p className="text-sm font-medium">{k.label}</p>
                  <p className="text-xs text-muted-foreground">{k.description}</p>
                </TD>
                <TD className="text-center">
                  <input
                    type="checkbox"
                    aria-label={`${k.label} under the bell`}
                    checked={row.inApp}
                    onChange={(e) => set(k.kind, "inApp", e.target.checked)}
                    className="h-4 w-4"
                  />
                </TD>
                <TD className="text-center">
                  <input
                    type="checkbox"
                    aria-label={`${k.label} by email`}
                    checked={row.email}
                    disabled={emailFixed}
                    onChange={(e) => set(k.kind, "email", e.target.checked)}
                    className="h-4 w-4"
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <div className="border-t p-4">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </Card>
  );
}
