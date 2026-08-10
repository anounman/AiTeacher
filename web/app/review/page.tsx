"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StudySession } from "@/components/study/StudySession";
import { Skeleton } from "@/components/Skeleton";
import type { CardDue } from "@/lib/db/reviews";

type DeckCount = { deckId: string; title: string; due: number; new: number };

export default function ReviewPage() {
  const [decks, setDecks] = useState<DeckCount[] | null>(null);
  const [queue, setQueue] = useState<CardDue[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/review/due")
      .then((r) => r.json())
      .then((d: { cards: CardDue[]; decks: DeckCount[] }) => {
        setDecks(d.decks);
        setQueue(d.cards);
      })
      .catch(() => setDecks([]))
      .finally(() => setLoading(false));
  }, []);

  const totalDue = decks?.reduce((a, d) => a + d.due + d.new, 0) ?? 0;
  const reload = () => {
    setQueue(null);
    fetch("/api/review/due")
      .then((r) => r.json())
      .then((d: { cards: CardDue[]; decks: DeckCount[] }) => {
        setDecks(d.decks);
        setQueue(d.cards);
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="graph-paper min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink">
            ← Back
          </Link>
          <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-rule" />
            Review
          </span>
        </div>

        {loading ? (
          <Skeleton className="h-8 w-1/2" />
        ) : (
          <>
            <h1 className="mb-2 text-[1.6rem] leading-tight text-ink">Review queue</h1>
            <p className="mono mb-6 text-[11px] tracking-wide text-ink-3">{totalDue} card{totalDue === 1 ? "" : "s"} due across all decks</p>

            {decks && decks.length > 0 && (
              <ul className="mb-6 space-y-1">
                {decks.map((d) => (
                  <li key={d.deckId} className="mono flex items-center justify-between rounded-[3px] border border-line bg-paper px-3 py-2 text-[12px]">
                    <Link href={`/decks/${d.deckId}`} className="text-ink hover:underline">{d.title}</Link>
                    <span className="tabular-nums text-ink-3">{d.due} due · {d.new} new</span>
                  </li>
                ))}
              </ul>
            )}

            {queue && queue.length > 0 ? (
              <StudySession queue={queue} onComplete={reload} />
            ) : (
              <div className="rounded-[3px] border border-line bg-paper-2 p-6 text-center mono text-[12px] text-ink-3">
                nothing due — come back later
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}