"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FlashcardDeck } from "@/components/FlashcardDeck";
import { StudySession } from "@/components/study/StudySession";
import { Skeleton } from "@/components/Skeleton";
import type { Card, Deck } from "@/lib/db/schema";
import type { CardDue } from "@/lib/db/reviews";

type Overview = {
  deck: Deck;
  cards: Card[];
  due: number;
  new: number;
  dailyCap: number;
  newIntroducedToday: number;
  lastReviewed: number | null;
};

export default function DeckOverviewPage() {
  const params = useParams<{ id: string }>();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<"review" | "browse">("review");
  const [queue, setQueue] = useState<CardDue[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/decks/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((o: Overview) => setOverview(o))
      .catch(() => setErr("Deck not found."))
      .finally(() => setLoading(false));
  }, [params.id]);

  const startReview = () => {
    setErr(null);
    fetch(`/api/decks/${params.id}/due`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { cards: CardDue[] }) => setQueue(d.cards))
      .catch(() => setErr("Could not load review queue."));
  };

  const reloadOverview = () => {
    setQueue(null);
    fetch(`/api/decks/${params.id}`)
      .then((r) => r.json())
      .then((o: Overview) => setOverview(o))
      .catch(() => {});
  };

  return (
    <div className="graph-paper page-scroll">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/decks" className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink">
            ← Back to decks
          </Link>
          <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-rule" />
            Review
          </span>
        </div>

        {loading ? (
          <Skeleton className="h-8 w-2/3" />
        ) : err || !overview ? (
          <p className="mono text-[13px] text-rule">{err ?? "Deck not found."}</p>
        ) : (
          <>
            <h1 className="mb-2 text-[1.6rem] leading-tight text-ink">{overview.deck.title}</h1>
            <p className="mono mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tracking-wide text-ink-3">
              <span className={overview.due > 0 ? "text-ink" : ""}>{overview.due} due</span>
              <span>{overview.new} new</span>
              <span>{overview.cards.length} total</span>
              {overview.lastReviewed && <span>last reviewed {new Date(overview.lastReviewed).toLocaleDateString()}</span>}
            </p>

            <div className="mb-6 flex gap-2">
              <button
                onClick={() => setTab("review")}
                className={`mono rounded-[3px] border px-3 py-1.5 text-[12px] tracking-wide ${tab === "review" ? "border-ink text-ink" : "border-line text-ink-3"}`}
              >
                Review
              </button>
              <button
                onClick={() => setTab("browse")}
                className={`mono rounded-[3px] border px-3 py-1.5 text-[12px] tracking-wide ${tab === "browse" ? "border-ink text-ink" : "border-line text-ink-3"}`}
              >
                Browse all
              </button>
            </div>

            {tab === "review" ? (
              queue ? (
                queue.length === 0 ? (
                  <div className="rounded-[3px] border border-line bg-paper-2 p-6 text-center mono text-[12px] text-ink-3">
                    nothing due — come back later
                  </div>
                ) : (
                  <StudySession queue={queue} deckLabel={overview.deck.title} onComplete={reloadOverview} />
                )
              ) : (
                <button
                  onClick={startReview}
                  disabled={overview.cards.length === 0}
                  className="mono rounded-[3px] border border-line bg-paper px-4 py-2 text-[13px] tracking-wide text-ink transition-colors hover:bg-paper-3 disabled:opacity-40"
                >
                  {overview.due + Math.min(overview.new, Math.max(0, overview.dailyCap - overview.newIntroducedToday)) > 0 ? "Start review" : "nothing due"}
                </button>
              )
            ) : (
              <FlashcardDeck
                cards={overview.cards.map((c) => ({ front: c.front, back: c.back }))}
                reviewMode
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}