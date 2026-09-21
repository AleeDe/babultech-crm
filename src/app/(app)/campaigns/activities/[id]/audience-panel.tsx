"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Search, Send, Trash2, UserPlus, X } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Table, THead, TBody, TR, TH, TD, EmptyState, Textarea,
} from "@/components/ui";
import { formatDate, formatDateTime, humanize } from "@/lib/utils";
import {
  addMembersToActivity, removeMemberFromActivity, recordOutcome,
  markActivityRun, sendCampaignEmail,
  type AudienceRow, type SendResult,
} from "@/server/campaign-activities";
import { listCampaignMembers, type CampaignMember } from "@/server/campaign-members";

/**
 * Who this activity goes to, and how it went for each of them.
 *
 * Picking the audience is deliberately manual. An automatic "everyone who
 * matches" would be quicker and would, sooner or later, mail somebody three
 * weeks running — so the search shows when each person was last contacted, and
 * somebody decides.
 */
export function AudiencePanel({
  activityId,
  activityType,
  status,
  audience,
  outcomeOptions,
}: {
  activityId: string;
  activityType: string;
  status: string;
  audience: AudienceRow[];
  outcomeOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<CampaignMember[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);

  const [recording, setRecording] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");

  const locked = status === "RUNNING" || status === "COMPLETED";
  const isEmail = activityType === "EMAIL";
  const alreadyIn = useMemo(() => new Set(audience.map((a) => a.memberId)), [audience]);

  // Searching on a delay rather than on every keystroke: the list is server
  // side and a query per character is both slow and pointless.
  useEffect(() => {
    if (!picking) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await listCampaignMembers({
          search: search.trim() || undefined,
          contactableOnly: isEmail,
        });
        setFound(results);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, picking, isEmail]);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addChosen() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await addMembersToActivity(activityId, [...chosen]);
      if (result.ok) {
        setNotice(
          `${result.data.added} added` +
            (result.data.alreadyThere ? `, ${result.data.alreadyThere} were already on the list` : "") +
            ".",
        );
        setChosen(new Set());
        setPicking(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  function remove(rowId: string) {
    setError(null);
    start(async () => {
      const result = await removeMemberFromActivity(rowId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function saveOutcome(rowId: string) {
    setError(null);
    start(async () => {
      const result = await recordOutcome({ rowId, outcome, notes: outcomeNotes });
      if (result.ok) {
        setRecording(null);
        setOutcome("");
        setOutcomeNotes("");
        router.refresh();
      } else setError(result.error);
    });
  }

  function finish() {
    if (!window.confirm("Mark this activity as run? Everyone on the list is stamped as contacted today.")) return;
    setError(null);
    start(async () => {
      const result = await markActivityRun(activityId);
      if (result.ok) {
        setNotice(`Done. ${result.data.touched} people are now marked as contacted today.`);
        router.refresh();
      } else setError(result.error);
    });
  }

  function send() {
    const count = audience.filter(
      (a) => !a.sentAt && a.member.email && !a.member.emailOptOut && !a.member.emailBounced,
    ).length;
    if (!window.confirm(`Send this email to ${count} ${count === 1 ? "person" : "people"}? It cannot be recalled.`)) return;

    setError(null);
    setNotice(null);
    setSendResult(null);
    start(async () => {
      const result = await sendCampaignEmail(activityId);
      if (result.ok) {
        setSendResult(result.data);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Audience ({audience.length})</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {locked
              ? "This activity has run, so its audience is now the record of who it reached."
              : "Who this goes to. Check when each person was last contacted before adding them."}
          </p>
        </div>
        {!locked && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { setPicking(!picking); setError(null); }}>
              <UserPlus className="h-4 w-4" /> {picking ? "Close" : "Add people"}
            </Button>
            {isEmail ? (
              <Button onClick={send} disabled={pending || audience.length === 0}>
                <Send className="h-4 w-4" /> {pending ? "Sending…" : "Send the email"}
              </Button>
            ) : (
              <Button onClick={finish} disabled={pending || audience.length === 0}>
                <CheckCircle2 className="h-4 w-4" /> Mark as run
              </Button>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {sendResult && (
          <Alert tone={sendResult.failed ? "warning" : "success"}>
            <p className="font-medium">
              {sendResult.sent} sent
              {sendResult.failed > 0 && `, ${sendResult.failed} failed`}
              {sendResult.skipped > 0 && `, ${sendResult.skipped} skipped`}.
            </p>
            {sendResult.skippedReasons.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs">
                {sendResult.skippedReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            <p className="mt-2 text-xs">
              Opens and clicks appear here as they happen, once the provider reports them.
            </p>
          </Alert>
        )}

        {picking && (
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <Field
              label="Find people to add"
              help={
                isEmail
                  ? "Only people who can be emailed are shown — anyone unsubscribed, bounced or without an address is left out."
                  : "Search by name, company or email."
              }
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="audience-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, company or email…"
                  className="pl-8"
                />
              </div>
            </Field>

            {searching && <p className="text-xs text-muted-foreground">Searching…</p>}

            {found.length > 0 && (
              <div className="max-h-80 overflow-y-auto rounded-md border">
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-10"> </TH>
                      <TH>Name</TH>
                      <TH>Company</TH>
                      <TH>Last contacted</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {found.map((m) => {
                      const already = alreadyIn.has(m.id);
                      return (
                        <TR key={m.id} className={already ? "opacity-50" : ""}>
                          <TD>
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input"
                              checked={chosen.has(m.id) || already}
                              disabled={already}
                              onChange={() => toggle(m.id)}
                              aria-label={`Add ${m.firstName}`}
                            />
                          </TD>
                          <TD className="text-sm">
                            {m.firstName} {m.lastName ?? ""}
                            <p className="text-xs text-muted-foreground">{m.email ?? m.phone ?? "—"}</p>
                          </TD>
                          <TD className="text-sm">{m.companyName ?? "—"}</TD>
                          <TD className="text-sm">
                            {already ? (
                              <Badge tone="neutral">Already on the list</Badge>
                            ) : m.lastCampaignRunAt ? (
                              <>
                                {formatDate(m.lastCampaignRunAt)}
                                <p className="text-xs text-muted-foreground">
                                  {m.lastCampaign?.name ?? `${m.campaignCount} campaigns`}
                                </p>
                              </>
                            ) : (
                              <span className="text-muted-foreground">Never</span>
                            )}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={addChosen} disabled={pending || chosen.size === 0}>
                Add {chosen.size} {chosen.size === 1 ? "person" : "people"}
              </Button>
              <Button variant="ghost" onClick={() => { setPicking(false); setChosen(new Set()); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {audience.length === 0 ? (
          <EmptyState
            title="Nobody on this activity yet"
            description="Add the people it should reach. You will see when each of them was last contacted."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <THead>
                <TR>
                  <TH>Person</TH>
                  <TH>Company</TH>
                  {isEmail ? (
                    <>
                      <TH>Sent</TH>
                      <TH>Opened</TH>
                      <TH>Clicked</TH>
                    </>
                  ) : (
                    <>
                      <TH>Outcome</TH>
                      <TH priority="tertiary">Notes</TH>
                    </>
                  )}
                  <TH className="w-24"> </TH>
                </TR>
              </THead>
              <TBody>
                {audience.map((row) => (
                  <TR key={row.id}>
                    <TD className="text-sm">
                      {row.member.firstName} {row.member.lastName ?? ""}
                      <p className="text-xs text-muted-foreground">
                        {row.member.email ?? row.member.phone ?? "No contact details"}
                      </p>
                    </TD>
                    <TD className="text-sm">{row.member.companyName ?? "—"}</TD>

                    {isEmail ? (
                      <>
                        <TD className="text-sm">
                          {row.bouncedAt ? (
                            <Badge tone="danger">Bounced</Badge>
                          ) : row.unsubscribedAt ? (
                            <Badge tone="warning">Unsubscribed</Badge>
                          ) : row.sentAt ? (
                            <span title={formatDateTime(row.sentAt)}>
                              {row.deliveredAt ? "Delivered" : "Sent"}
                            </span>
                          ) : row.failReason ? (
                            <Badge tone="danger" title={row.failReason}>Failed</Badge>
                          ) : (
                            <span className="text-muted-foreground">Not yet</span>
                          )}
                        </TD>
                        <TD className="text-sm">
                          {row.openedAt ? (
                            <>
                              Yes
                              {row.openCount > 1 && (
                                <span className="text-xs text-muted-foreground"> ×{row.openCount}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TD>
                        <TD className="text-sm">
                          {row.clickedAt ? (
                            <>
                              Yes
                              {row.clickCount > 1 && (
                                <span className="text-xs text-muted-foreground"> ×{row.clickCount}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TD>
                      </>
                    ) : (
                      <>
                        <TD className="text-sm">
                          {recording === row.id ? (
                            <Select
                              id={`outcome-${row.id}`}
                              value={outcome}
                              onChange={(e) => setOutcome(e.target.value)}
                            >
                              <option value="">Choose…</option>
                              {outcomeOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </Select>
                          ) : row.outcome ? (
                            <Badge tone="neutral">{humanize(row.outcome)}</Badge>
                          ) : (
                            <span className="text-muted-foreground">Not recorded</span>
                          )}
                        </TD>
                        <TD className="text-sm">
                          {recording === row.id ? (
                            <Textarea
                              id={`notes-${row.id}`}
                              rows={2}
                              value={outcomeNotes}
                              onChange={(e) => setOutcomeNotes(e.target.value)}
                              placeholder="What they said"
                            />
                          ) : (
                            row.outcomeNotes ?? "—"
                          )}
                        </TD>
                      </>
                    )}

                    <TD>
                      <div className="flex justify-end gap-1">
                        {!isEmail && (recording === row.id ? (
                          <>
                            <Button size="sm" disabled={pending || !outcome} onClick={() => saveOutcome(row.id)}>
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRecording(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRecording(row.id);
                              setOutcome(row.outcome ?? "");
                              setOutcomeNotes(row.outcomeNotes ?? "");
                            }}
                          >
                            {row.outcome ? "Change" : "Record"}
                          </Button>
                        ))}
                        {!locked && !row.sentAt && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => remove(row.id)}
                            aria-label="Remove from this activity"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
