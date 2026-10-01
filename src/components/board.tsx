"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cn, formatCompactMoney } from "@/lib/utils";
import type { BoardCard } from "@/server/boards";

export interface BoardColumn {
  key: string;
  label: string;
  /** Asked before a card lands here, e.g. why a deal was lost. Null cancels the move. */
  ask?: string;
}

/**
 * A board of cards in columns. Drag a card to another column to move it, or
 * use its own "Move to" list - the same thing for a keyboard or a phone.
 *
 * The card moves at once and the move is saved in the background; if the save
 * is refused (a deal that cannot be won yet, a case with no resolution) the
 * card goes back and the reason is shown.
 */
export function Board({
  columns,
  cards: initial,
  move,
  canMove,
  showAmounts = false,
}: {
  columns: BoardColumn[];
  cards: BoardCard[];
  move: (id: string, column: string, answer?: string | null) => Promise<{ ok: boolean; error?: string }>;
  canMove: boolean;
  showAmounts?: boolean;
}) {
  const [cards, setCards] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function moveCard(id: string, to: string) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.column === to) return;
    const column = columns.find((c) => c.key === to);
    let answer: string | null = null;
    if (column?.ask) {
      answer = window.prompt(column.ask);
      if (!answer?.trim()) return;
    }
    const from = card.column;
    setError(null);
    setCards((list) => list.map((c) => (c.id === id ? { ...c, column: to } : c)));
    start(async () => {
      const result = await move(id, to, answer);
      if (!result.ok) {
        setCards((list) => list.map((c) => (c.id === id ? { ...c, column: from } : c)));
        setError(`${card.title}: ${result.error ?? "it could not be moved."}`);
      }
    });
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => {
          const inColumn = cards.filter((c) => c.column === col.key);
          const total = inColumn.reduce((s, c) => s + (c.amount ?? 0), 0);
          return (
            <section
              key={col.key}
              aria-label={col.label}
              data-column={col.key}
              onDragOver={(e) => {
                if (!canMove || !dragging) return;
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain") || dragging;
                if (id) moveCard(id, col.key);
                setDragging(null);
              }}
              className={cn(
                "flex w-64 shrink-0 flex-col rounded-lg border bg-muted/30",
                over === col.key && "border-primary bg-primary/5",
              )}
            >
              <header className="border-b px-3 py-2">
                <p className="text-sm font-semibold">{col.label}</p>
                <p className="text-xs text-muted-foreground">
                  {inColumn.length}
                  {showAmounts && total > 0 ? ` · ${formatCompactMoney(total)}` : ""}
                </p>
              </header>
              <ul className="flex min-h-24 flex-col gap-2 p-2">
                {inColumn.map((card) => (
                  <li
                    key={card.id}
                    draggable={canMove}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", card.id);
                      setDragging(card.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      "rounded-md border bg-card p-2.5 text-sm shadow-sm",
                      canMove && "cursor-grab active:cursor-grabbing",
                      dragging === card.id && "opacity-50",
                    )}
                  >
                    <Link href={card.href} className="font-medium hover:underline">{card.title}</Link>
                    {card.subtitle && <p className="text-xs text-muted-foreground">{card.subtitle}</p>}
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{card.meta}</span>
                      {showAmounts && card.amount ? <span className="shrink-0 tabular-nums">{formatCompactMoney(card.amount)}</span> : null}
                    </div>
                    {canMove && (
                      <select
                        aria-label={`Move ${card.title} to`}
                        value=""
                        onChange={(e) => e.target.value && moveCard(card.id, e.target.value)}
                        className="mt-2 w-full rounded border bg-transparent px-1 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <option value="">Move to…</option>
                        {columns.filter((c) => c.key !== card.column).map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
