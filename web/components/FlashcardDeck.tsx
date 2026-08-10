"use client";

import { memo, useMemo, useState } from "react";
import Link from "next/link";
import { Markdown } from "./Markdown";
import { parseFlashcards, type Flashcard } from "@/lib/flashcards/parse";

interface Props {
  // Raw ```flashcard block source (used inline in chat). Parsed here.
  source?: string;
  // Pre-parsed cards (used by the /decks/[id] review page).
  cards?: Flashcard[];
  // conversation context for the inline "save to my decks" flow.
  conversationTitle?: string;
  conversationId?: string;
  // Review page hides the save button (the deck is already saved).
  reviewMode?: boolean;
}

// Renders a flip-card deck: one card at a time, click to flip front/back,
// prev/next (clamped at ends), a counter, and shuffle. Faces render through
// the shared <Markdown> so math ($...$) and inline formatting work.
//
// No iframe and no dangerouslySetInnerHTML — faces go through react-markdown,
// which sanitizes raw HTML by default. So a ```flashcard block is the same
// trust level as any normal chat reply.
export const FlashcardDeck = memo(function FlashcardDeck({
  source,
  cards: cardsProp,
  conversationTitle,
  conversationId,
  reviewMode = false,
}: Props) {
  // Parse the source once; fall back to pre-parsed cards. While streaming the
  // parent (Markdown PreBlock) shows a placeholder, so by the time we mount
  // there is always ≥1 card.
  const parsed = useMemo(
    () => (source !== undefined ? parseFlashcards(source) : null),
    [source],
  );
  const cards = parsed ? parsed.cards : cardsProp ?? [];

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // order is a permutation of indices; shuffle reorders it, reset restores
  // 0..n-1. We keep an array (not just a seed) so prev/next traverse the
  // shuffled order naturally.
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));

  // Reset navigation when the card set changes (e.g. a re-parse after stream
  // completion, or a different deck loaded into the review page). Compare by
  // length as a cheap stable proxy; contents are immutable per source.
  const [lastLen, setLastLen] = useState(cards.length);
  if (cards.length !== lastLen) {
    setLastLen(cards.length);
    setIndex(0);
    setFlipped(false);
    setOrder(cards.map((_, i) => i));
  }

  const [savedDeckId, setSavedDeckId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (cards.length === 0) {
    return (
      <div className="mono my-2 rounded-[3px] border border-line bg-paper-2 px-4 py-3 text-[12px] text-ink-3">
        no flashcards
      </div>
    );
  }

  const total = cards.length;
  const pos = Math.min(index, total - 1);
  const card = cards[order[pos]] ?? cards[pos];

  function go(delta: number) {
    setFlipped(false);
    setIndex((i) => Math.max(0, Math.min(i + delta, total - 1)));
  }

  function shuffle() {
    setFlipped(false);
    setIndex(0);
    setOrder((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  }

  async function save() {
    if (saving || savedDeckId) return;
    setSaving(true);
    setSaveError(null);
    const title =
      (parsed?.title && parsed.title.trim()) ||
      (conversationTitle ? `Flashcards · ${conversationTitle}` : "Untitled deck");
    try {
      const res = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, cards, conversationId: conversationId ?? null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "save failed");
      }
      const deck = (await res.json()) as { id: string };
      setSavedDeckId(deck.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-[3px] border border-line bg-paper-2">
      <div className="mono flex items-center gap-2 border-b border-line bg-paper-3 px-3 py-1.5 text-[10px] tracking-wide text-ink-3">
        <span className="h-1 w-1 rounded-full bg-rule" />
        flashcards · {total} card{total === 1 ? "" : "s"}
        <span className="ml-auto tabular-nums">
          {pos + 1} / {total}
        </span>
      </div>

      {/* Card face — click (or Enter/Space) to flip. A div rather than a button
          so Markdown can render block-level content (<p>, lists, KaTeX) without
          invalid nesting inside a <button>. Min height keeps the layout stable
          as you flip and move between cards of different lengths. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setFlipped((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFlipped((f) => !f);
          }
        }}
        className="block min-h-[140px] w-full cursor-pointer border-b border-line bg-paper px-5 py-4 text-left transition-colors hover:bg-paper-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-rule/40"
        aria-label={flipped ? "Show front" : "Show back"}
      >
        <div className="mono mb-2 text-[10px] tracking-wide text-ink-3">
          {flipped ? "A" : "Q"}
        </div>
        <Markdown content={flipped ? card.back : card.front} className="prose-chat text-[15px] leading-relaxed text-ink" />
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          className="mono rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink-2 transition-colors hover:border-ink/40"
        >
          flip
        </button>
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={pos === 0}
          className="mono rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink-2 transition-colors hover:border-ink/40 disabled:opacity-40"
        >
          ‹ prev
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={pos >= total - 1}
          className="mono rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink-2 transition-colors hover:border-ink/40 disabled:opacity-40"
        >
          next ›
        </button>
        <button
          type="button"
          onClick={shuffle}
          className="mono rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink-2 transition-colors hover:border-ink/40"
        >
          shuffle
        </button>

        {!reviewMode && (
          <div className="ml-auto flex items-center gap-3">
            {savedDeckId ? (
              <span className="mono flex items-center gap-2 text-[12px] text-feynman">
                saved ✓
                <Link
                  href={`/decks/${savedDeckId}`}
                  className="text-ink-2 underline-offset-2 hover:underline"
                >
                  open →
                </Link>
              </span>
            ) : (
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="mono rounded-[3px] bg-ink px-3 py-1.5 text-[12px] tracking-wide text-paper-2 transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "saving…" : "save to my decks"}
              </button>
            )}
          </div>
        )}
      </div>

      {saveError && (
        <div className="mono px-3 pb-2 text-[11px] text-rule">{saveError}</div>
      )}
    </div>
  );
});