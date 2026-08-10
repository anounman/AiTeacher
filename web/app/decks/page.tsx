"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { Skeleton } from "@/components/Skeleton";
import type { Card, Deck } from "@/lib/db/schema";

type DeckWithCount = Deck & { card_count: number };

export default function DecksPage() {
  const [decks, setDecks] = useState<DeckWithCount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadDecks = useCallback(async () => {
    const res = await fetch("/api/decks");
    if (res.ok) setDecks(await res.json());
  }, []);

  const loadCards = useCallback(async (id: string) => {
    const res = await fetch(`/api/decks/${id}`);
    if (res.ok) {
      const d: { deck: Deck; cards: Card[] } = await res.json();
      setCards(d.cards);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDecks().finally(() => setLoading(false));
  }, [loadDecks]);

  // Select the first deck once decks load (if none selected); fall back if the
  // selected deck was deleted.
  useEffect(() => {
    if (!selectedId && decks.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(decks[0].id);
    }
    if (selectedId && !decks.some((d) => d.id === selectedId)) {
      setSelectedId(decks[0]?.id ?? null);
      setCards([]);
    }
  }, [decks, selectedId]);

  // Load cards when the selection changes.
  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCards([]);
      return;
    }
    loadCards(selectedId);
  }, [selectedId, loadCards]);

  async function renameDeck(id: string) {
    const title = renameValue.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    await fetch(`/api/decks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setRenamingId(null);
    await loadDecks();
  }

  async function deleteDeck(id: string) {
    await fetch(`/api/decks/${id}`, { method: "DELETE" });
    setConfirmDeleteId(null);
    if (selectedId === id) {
      setSelectedId(null);
      setCards([]);
    }
    await loadDecks();
  }

  const selected = decks.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="graph-paper page-scroll">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink"
          >
            ← Back to chat
          </Link>
          <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-rule" />
            Decks
          </span>
        </div>

        <h1 className="mb-6 text-[1.6rem] leading-tight text-ink">Flashcard decks</h1>

        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          {/* Left column: deck list */}
          <section className="rounded-[3px] border border-line bg-paper-2 p-4">
            <ul className="flex flex-col gap-1">
              {loading && decks.length === 0 && (
                <div className="flex flex-col gap-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-2">
                      <Skeleton className="h-3.5 flex-1" />
                      <Skeleton className="h-3 w-8" />
                    </div>
                  ))}
                </div>
              )}
              {!loading && decks.length === 0 && (
                <li className="mono px-1 py-3 text-[11px] text-ink-3">
                  no decks yet — ask for flashcards in chat and click “save to my decks”
                </li>
              )}
              {decks.map((d) => {
                const active = d.id === selectedId;
                const renaming = d.id === renamingId;
                const confirming = d.id === confirmDeleteId;
                return (
                  <li key={d.id} className="group">
                    {renaming ? (
                      <div className="flex gap-1">
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => renameDeck(d.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameDeck(d.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          className="mono w-full rounded-[3px] border border-line bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-ink/40"
                        />
                      </div>
                    ) : confirming ? (
                      <div className="flex items-center gap-2 rounded-[3px] bg-paper px-2 py-1.5">
                        <span className="mono flex-1 truncate text-[11px] text-rule">
                          delete?
                        </span>
                        <button
                          onClick={() => deleteDeck(d.id)}
                          className="mono text-[11px] text-rule hover:underline"
                        >
                          yes
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="mono text-[11px] text-ink-3 hover:underline"
                        >
                          no
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`flex items-center gap-1.5 rounded-[3px] px-2 py-1.5 transition-colors ${
                          active ? "bg-paper" : "hover:bg-paper/60"
                        }`}
                      >
                        <button
                          onClick={() => setSelectedId(d.id)}
                          className="flex-1 truncate text-left text-[13px] text-ink"
                        >
                          {d.title}
                        </button>
                        <span className="mono text-[10px] tabular-nums text-ink-3">
                          {d.card_count}
                        </span>
                        <Link
                          href={`/decks/${d.id}`}
                          aria-label="Review deck"
                          className="mono text-[11px] text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                        >
                          ▶
                        </Link>
                        <button
                          onClick={() => {
                            setRenamingId(d.id);
                            setRenameValue(d.title);
                          }}
                          aria-label="Rename deck"
                          className="mono text-[11px] text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(d.id)}
                          aria-label="Delete deck"
                          className="mono text-[11px] text-ink-3 opacity-0 transition-opacity hover:text-rule group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Right column: card preview for the selected deck */}
          <section className="rounded-[3px] border border-line bg-paper-2 p-4">
            {!selected ? (
              <p className="mono py-10 text-center text-[12px] text-ink-3">
                select a deck to preview its cards
              </p>
            ) : (
              <>
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="text-[18px] text-ink">{selected.title}</h2>
                  <div className="flex items-center gap-3">
                    <span className="mono text-[11px] tracking-wide text-ink-3">
                      {cards.length} card{cards.length === 1 ? "" : "s"}
                    </span>
                    <Link
                      href={`/decks/${selected.id}`}
                      className="mono rounded-[3px] bg-ink px-3 py-1.5 text-[12px] tracking-wide text-paper-2 transition-opacity hover:opacity-90"
                    >
                      review →
                    </Link>
                  </div>
                </div>

                <ul className="flex flex-col gap-2">
                  {cards.length === 0 && (
                    <li className="mono py-6 text-center text-[11px] text-ink-3">
                      no cards
                    </li>
                  )}
                  {cards.map((c, i) => (
                    <li
                      key={c.id}
                      className="rounded-[3px] border border-line bg-paper px-3 py-2.5"
                    >
                      <div className="mono mb-1 text-[10px] tracking-wide text-ink-3">
                        {i + 1} · Q
                      </div>
                      <Markdown content={c.front} className="prose-chat text-[14px] leading-relaxed text-ink" />
                      <div className="mono mt-2 mb-1 text-[10px] tracking-wide text-ink-3">
                        A
                      </div>
                      <Markdown content={c.back} className="prose-chat text-[14px] leading-relaxed text-ink-2" />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}