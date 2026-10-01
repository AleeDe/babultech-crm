import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listApprovalRules, listAutomationRules, listAutomationLog } from "@/server/automation";
import { getAssignableUsers } from "@/server/bulk";
import { PageHeader, Forbidden, Card, CardHeader, CardTitle, CardContent, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { ApprovalRulesEditor, AutomationRulesEditor } from "./rules-editor";

const ENTITY_PATH: Record<string, string> = {
  Lead: "/leads/",
  Opportunity: "/opportunities/",
  SupportCase: "/cases/",
};

const RULE_LABEL: Record<string, string> = {
  LEAD_ROUND_ROBIN: "Share website leads in turn",
  LEAD_NO_FOLLOW_UP: "No follow-up date",
  DEAL_STALE: "Deal not moving",
  CASE_RESPONSE_WARNING: "First response due soon",
};

export default async function AutomationSettingsPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="approval and automatic rules" />;
  const [approvalRules, automationRules, log, users] = await Promise.all([
    listApprovalRules(),
    listAutomationRules(),
    listAutomationLog(50),
    getAssignableUsers(),
  ]);

  return (
    <>
      <PageHeader
        backTo="/settings"
        backLabel="Back to settings"
        title="Approval and automatic rules"
        description="When a quote needs approval before it is sent, and the jobs the CRM does by itself. Each automatic rule is off until you switch it on."
      />

      <ApprovalRulesEditor rules={approvalRules} />

      <AutomationRulesEditor rules={automationRules} users={users.map((u: { id: string; fullName: string }) => ({ id: u.id, fullName: u.fullName }))} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>What the rules did</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">The latest 50 actions. Kept for 90 days.</p>
        </CardHeader>
        {log.length === 0 ? (
          <CardContent><p className="text-sm text-muted-foreground">Nothing yet.</p></CardContent>
        ) : (
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Rule</TH>
                  <TH>What it did</TH>
                </TR>
              </THead>
              <TBody>
                {log.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-sm">{formatDateTime(l.createdAt)}</TD>
                    <TD className="text-sm">{RULE_LABEL[l.ruleKey] ?? l.ruleKey}</TD>
                    <TD className="text-sm">
                      {l.entityType && l.entityId && ENTITY_PATH[l.entityType] ? (
                        <Link href={`${ENTITY_PATH[l.entityType]}${l.entityId}`} className="hover:underline">{l.action}</Link>
                      ) : (
                        l.action
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </>
  );
}
