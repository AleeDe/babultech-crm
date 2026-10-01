"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Send, X } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui";
import { askAssistant, assistantRaiseCase, escalateConversation, type AssistantLink } from "@/server/assistant";

/**
 * The portal assistant: a chat panel in the customer and partner portals.
 * Answers come from server/assistant.ts under the person's own session. Raising
 * a case is a short guided conversation - what is wrong, the details, how
 * urgent - and the conversation goes into the case.
 */

type Message = {
  from: "you" | "assistant";
  text: string;
  links?: AssistantLink[];
  suggestions?: string[];
  offerEscalation?: boolean;
};

type CaseFlow =
  | { step: "subject" }
  | { step: "details"; subject: string }
  | { step: "priority"; subject: string; details: string }
  | { step: "confirm"; subject: string; details: string; priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" };

const PRIORITIES = [
  { value: "LOW", label: "Not urgent" },
  { value: "MEDIUM", label: "Normal" },
  { value: "HIGH", label: "Urgent" },
  { value: "CRITICAL", label: "Everything is down" },
] as const;

export function PortalAssistant({ audience }: { audience: "customer" | "partner" }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      from: "assistant",
      text: audience === "customer"
        ? "Hello! Ask me about your tickets or projects, search the help articles, or let me raise a case for you."
        : "Hello! Ask me about your deals or commission, or start a deal registration.",
      suggestions: audience === "customer"
        ? ["Show my open cases", "Has someone replied to my case?", "Show my active projects", "Create a case"]
        : ["Show my opportunities", "What commission is pending?", "How does our commission agreement work?", "Create a deal registration"],
    },
  ]);
  const [draft, setDraft] = useState("");
  const [flow, setFlow] = useState<CaseFlow | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  const say = (m: Message) => setMessages((list) => [...list, m]);
  const transcript = (list = messages) =>
    list.map((m) => `${m.from === "you" ? "You" : "Assistant"}: ${m.text}${m.links?.length ? ` (${m.links.map((l) => l.label).join("; ")})` : ""}`).join("\n");

  function startCase(problem: string | null) {
    if (problem) {
      setFlow({ step: "details", subject: problem.slice(0, 200) });
      say({ from: "assistant", text: "Tell me a little more: what happened, since when, and what you have tried." });
    } else {
      setFlow({ step: "subject" });
      say({ from: "assistant", text: "In a sentence, what is the problem?" });
    }
  }

  function send(textIn?: string) {
    const text = (textIn ?? draft).trim();
    if (!text || pending) return;
    setDraft("");
    say({ from: "you", text });

    if (flow?.step === "subject") {
      setFlow({ step: "details", subject: text.slice(0, 200) });
      say({ from: "assistant", text: "Tell me a little more: what happened, since when, and what you have tried." });
      return;
    }
    if (flow?.step === "details") {
      setFlow({ step: "priority", subject: flow.subject, details: text });
      say({ from: "assistant", text: "How urgent is it?" });
      return;
    }

    start(async () => {
      const reply = await askAssistant(text);
      say({ from: "assistant", text: reply.text, links: reply.links, suggestions: reply.suggestions, offerEscalation: reply.offerEscalation });
      if (reply.startCase) startCase(reply.startCase.problem);
    });
  }

  function choosePriority(priority: (typeof PRIORITIES)[number]["value"]) {
    if (flow?.step !== "priority") return;
    const label = PRIORITIES.find((p) => p.value === priority)!.label;
    say({ from: "you", text: label });
    setFlow({ step: "confirm", subject: flow.subject, details: flow.details, priority });
    say({ from: "assistant", text: `I will raise "${flow.subject}" as ${label.toLowerCase()}. Shall I go ahead?` });
  }

  function raise() {
    if (flow?.step !== "confirm") return;
    const current = flow;
    start(async () => {
      const result = await assistantRaiseCase({ subject: current.subject, description: current.details, priority: current.priority, transcript: transcript() });
      setFlow(null);
      if (!result.ok) return say({ from: "assistant", text: `That did not work: ${result.error}` });
      say({
        from: "assistant",
        text: `Your case ${result.data.caseNumber} has been created. The support team has been notified. You can carry on the conversation on the case page.`,
        links: [{ href: `/support/tickets/${result.data.id}`, label: `Open ${result.data.caseNumber}` }],
      });
    });
  }

  function escalate() {
    start(async () => {
      const result = await escalateConversation(transcript());
      if (!result.ok) return say({ from: "assistant", text: `That did not work: ${result.error}` });
      say({ from: "assistant", text: result.data.text, links: [{ href: result.data.href, label: "Open it" }] });
    });
  }

  const lastQuestion = [...messages].reverse().find((m) => m.from === "you")?.text ?? null;

  // The launcher sits in the menu, where it covers nothing on the page. The
  // panel goes to the body: the menu is transformed, which would pin a fixed
  // panel inside it.
  const launcher = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className="flex w-full items-center gap-2.5 rounded-md border bg-primary/5 px-2 py-2 text-sm font-medium text-primary hover:bg-primary/10"
    >
      <MessageCircle className="h-4 w-4" /> Ask the assistant
    </button>
  );
  if (!open) return launcher;

  return (
    <>
    {launcher}
    {createPortal(
    <section
      aria-label="Portal assistant"
      className="fixed inset-x-2 bottom-2 z-40 flex max-h-[80vh] flex-col rounded-xl border bg-background shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-semibold">Assistant</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close the assistant" className="rounded p-1 hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" data-assistant-log>
        {messages.map((m, i) => (
          <div key={i} className={m.from === "you" ? "flex justify-end" : ""}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 ${m.from === "you" ? "bg-primary text-primary-foreground" : "bg-muted"}`} data-from={m.from}>
              <p className="whitespace-pre-line">{m.text}</p>
              {m.links?.length ? (
                <ul className="mt-2 space-y-1">
                  {m.links.map((l) => (
                    <li key={l.href + l.label}>
                      <a href={l.href} className="text-primary underline-offset-2 hover:underline" {...(/^https?:/.test(l.href) ? { target: "_blank", rel: "noreferrer" } : {})}>
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {i === messages.length - 1 && m.suggestions?.length && !flow ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-accent">{s}</button>
                  ))}
                </div>
              ) : null}
              {i === messages.length - 1 && m.offerEscalation && !flow ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {audience === "customer" && (
                    <button type="button" onClick={() => startCase(lastQuestion)} className="rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-accent">Create a support case</button>
                  )}
                  <button type="button" onClick={escalate} disabled={pending} className="rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-accent">
                    {audience === "customer" ? "Send this conversation to support" : "Send this to my partner manager"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {flow?.step === "priority" && (
          <div className="flex flex-wrap gap-1">
            {PRIORITIES.map((p) => (
              <button key={p.value} type="button" onClick={() => choosePriority(p.value)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent">{p.label}</button>
            ))}
          </div>
        )}
        {flow?.step === "confirm" && (
          <div className="flex gap-2">
            <Button size="sm" onClick={raise} disabled={pending}>{pending ? "Raising…" : "Raise the case"}</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setFlow(null); say({ from: "assistant", text: "No problem - nothing was raised." }); }}>Cancel</Button>
          </div>
        )}
        {pending && <p className="text-xs text-muted-foreground">…</p>}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 border-t p-3">
        {flow?.step === "details" ? (
          <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Describe what is happening" aria-label="Message the assistant" />
        ) : (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
            placeholder={flow?.step === "subject" ? "The problem, in a sentence" : "Ask a question"}
            aria-label="Message the assistant"
            disabled={flow?.step === "priority" || flow?.step === "confirm"}
          />
        )}
        <Button size="sm" onClick={() => send()} disabled={pending || !draft.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </section>,
    document.body,
    )}
    </>
  );
}
