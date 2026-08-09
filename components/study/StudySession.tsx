"use client";

import { useCallback, useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";
import type { CardDue } from "@/lib/db/reviews";
import type { Band } from "@/lib/mastery/model";

type Grade = 1 | 2 | 3 | 4;

// Band → Graph Paper border token for the flip-card. Slipping cards get the
// rule (red) accent, strong cards the feynman (green) accent, learning cards
// the ink accent, and untested/unknown/undefined fall back to the line border.
function bandBorder(band?: Band): string {
  switch (band) {
    case "slipping":
      return "border-rule";
    case "strong":
      return "border-feynman";
    case "learning":
      return "border-ink";
    default:
      return "border-line"; // untested + unknown
  }
}

const GRADE_BUTTONS: { grade: Grade; label: string; cls: string }[] = [
  { grade: 1, label: "Again", cls: "border-rule text-rule" },
  { grade: 2, label: "Hard", cls: "border-ink-3 text-ink-3" },
  { grade: 3, label: "Good", cls: "border-ink text-ink" },
  { grade: 4, label: "Easy", cls: "border-ink-2 text-ink-2" },
];

// Shared review session: flip a card, grade it (Again/Hard/Good/Easy), POST the
// grade, advance. "Again" cards are re-queued to the tail once (max one extra
// re-show per card per session) for immediate practice; the persisted due is
// whatever FSRS computed on the server. On a grade POST failure, stay on the
// card and show a text-rule error so the grade is never silently lost.
export function StudySession({
  queue,
  deckLabel,
  onComplete,
}: {
  queue: CardDue[];
  deckLabel?: string;
  onComplete?: () => void;
}) {
  // `remaining` is the working queue; we pop the front and may push "Again"
  // cards back onto the tail. `reshown` ensures one extra re-show max.
  const [remaining, setRemaining] = useState<CardDue[]>(queue);
  const [flipped, setFlipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [againCount, setAgainCount] = useState(0);
  const [reshown, setReshown] = useState<Set<string>>(new Set());

  const current = remaining[0] ?? null;
  const total = queue.length;

  const advance = useCallback((card: CardDue, grade: Grade) => {
    setRemaining((prev) => {
      const rest = prev.slice(1);
      if (grade === 1 && !reshown.has(card.id)) {
        setReshown((s) => new Set(s).add(card.id));
        return [...rest, card]; // re-queue once
      }
      return rest;
    });
    setReviewed((n) => n + 1);
    if (grade === 1) setAgainCount((n) => n + 1);
    setFlipped(false);
    setError(null);
  }, [reshown]);

  const handleGrade = useCallback(
    async (grade: Grade) => {
      if (!current || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const r = await fetch("/api/review/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: current.id, grade }),
        });
        if (!r.ok) throw new Error("grade failed");
        advance(current, grade);
      } catch {
        setError("Could not save grade — retry.");
      } finally {
        setSubmitting(false);
      }
    },
    [current, submitting, advance],
  );

  // One-shot transition to the summary view once the working queue is drained.
  // Effect form (not a render-time setState) to avoid calling setState during
  // render.
  useEffect(() => {
    if (remaining.length === 0 && !done) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot transition to the derived "done" summary view; runs once when the queue drains.
      setDone(true);
    }
  }, [remaining.length, done]);

  if (done) {
    return (
      <div className="rounded-[3px] border border-line bg-paper-2 p-6">
        <div className="mono text-[11px] tracking-wide text-ink-3">session complete</div>
        <div className="mt-3 text-[1.2rem] text-ink">
          {reviewed} reviewed · <span className="text-rule">{againCount} again</span>
        </div>
        {onComplete && (
          <button
            onClick={onComplete}
            className="mono mt-6 rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:bg-paper-3"
          >
            done
          </button>
        )}
      </div>
    );
  }

  if (!current) return null;

  const bandClass = bandBorder(current.band);

  return (
    <div>
      <div className="mono mb-4 flex items-center justify-between text-[12px] tracking-wide tabular-nums text-ink-3">
        <span>
          {deckLabel ? `${deckLabel} · ` : ""}
          {total - remaining.length + 1} / {total}
        </span>
        {current.state === 0 && <span className="text-ink-3">new</span>}
      </div>

      {error && <div className="mono mb-3 text-[11px] text-rule">{error}</div>}

      {/* Cross-deck card badge: shown only in cross-deck mode (no per-deck label). */}
      {!deckLabel && current.deckTitle && (
        <div className="mono mb-2 text-[10px] tracking-wide text-ink-3">{current.deckTitle}</div>
      )}

      {/* Card */}
      <button
        onClick={() => setFlipped((f) => !f)}
        className={`block w-full rounded-[3px] border bg-paper p-6 text-left transition-colors hover:border-ink-3 ${bandClass}`}
      >
        <div className="mono mb-3 text-[10px] tracking-wide text-ink-3">
          {flipped ? "back" : "front"} · click to flip{current.band ? ` · ${current.band}` : ""}
        </div>
        <div className="text-[1rem] leading-relaxed text-ink">
          <Markdown content={flipped ? current.back : current.front} />
        </div>
      </button>

      {/* Grade buttons (enabled after flipping) */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {GRADE_BUTTONS.map((b) => (
          <button
            key={b.grade}
            disabled={!flipped || submitting}
            onClick={() => handleGrade(b.grade)}
            className={`mono rounded-[3px] border bg-paper px-2 py-2 text-[12px] tracking-wide transition-opacity ${b.cls} ${
              !flipped || submitting ? "opacity-30" : "hover:bg-paper-3"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}