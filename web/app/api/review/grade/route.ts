import { NextResponse } from "next/server";
import { getCard, getCardScheduling, upsertCardScheduling, appendReviewLog } from "@/lib/db";
import { repeat, Rating, CardState, type SchedCard } from "@/lib/fsrs/algorithm";
import { linkCardToConcepts } from "@/lib/mastery/link";

// POST /api/review/grade — grade a card, update its FSRS schedule, append a
// review_log row. Body: { cardId, grade }. Deck-agnostic (used by both the
// per-deck session and the cross-deck queue).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cardId = typeof body.cardId === "string" ? body.cardId : null;
  const grade = Number(body.grade);
  if (!cardId || !Number.isInteger(grade) || grade < 1 || grade > 4) {
    return NextResponse.json({ error: "cardId and grade (1-4) required" }, { status: 400 });
  }
  const card = getCard(cardId);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const existing = getCardScheduling(cardId);
  const prev: SchedCard | null = existing
    ? {
        due: existing.due,
        stability: existing.stability,
        difficulty: existing.difficulty,
        reps: existing.reps,
        lapses: existing.lapses,
        state: existing.state as CardState,
        last_review: existing.last_review,
      }
    : null;

  const now = Date.now();
  const { card: next, log } = repeat(prev, grade as Rating, now);

  upsertCardScheduling(cardId, next);
  appendReviewLog({
    cardId,
    deckId: card.deck_id,
    grade: grade as Rating,
    state: log.state,
    stability: log.stability,
    difficulty: log.difficulty,
    reviewedAt: now,
  });
  // SP4: best-effort card ↔ concept auto-link. Fire-and-forget so grading
  // stays snappy; failures are swallowed inside linkCardToConcepts.
  void linkCardToConcepts(cardId).catch(() => {});
  return NextResponse.json({ state: next.state, nextDue: next.due, reps: next.reps, lapses: next.lapses });
}