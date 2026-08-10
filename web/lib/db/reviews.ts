import { db } from "./index";
import { getDeck } from "./decks";
import type { CardScheduling } from "./schema";
import { Rating, CardState, type SchedCard } from "@/lib/fsrs/algorithm";
import type { Band } from "@/lib/mastery/model";

export interface CardDue {
  id: string;
  front: string;
  back: string;
  deckId: string;
  deckTitle: string;
  state: CardState;
  due: number | null; // null for new cards
  mastery?: number | null;
  band?: Band;
}

function startOfTodayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function getCardScheduling(cardId: string): CardScheduling | undefined {
  return db.prepare("SELECT * FROM card_scheduling WHERE card_id = ?").get(cardId) as
    | CardScheduling
    | undefined;
}

export function upsertCardScheduling(cardId: string, c: SchedCard): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO card_scheduling (card_id, due, stability, difficulty, reps, lapses, state, last_review, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(card_id) DO UPDATE SET
       due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
       reps = excluded.reps, lapses = excluded.lapses, state = excluded.state,
       last_review = excluded.last_review, updated_at = excluded.updated_at`,
  ).run(cardId, c.due, c.stability, c.difficulty, c.reps, c.lapses, c.state, c.last_review, now, now);
}

export function appendReviewLog(entry: {
  cardId: string; deckId: string; grade: Rating; state: CardState;
  stability: number; difficulty: number; reviewedAt: number;
}): void {
  db.prepare(
    `INSERT INTO review_log (id, card_id, deck_id, grade, state, stability, difficulty, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), entry.cardId, entry.deckId, entry.grade, entry.state, entry.stability, entry.difficulty, entry.reviewedAt);
}

// Distinct new cards introduced today (state BEFORE review was New=0).
export function newIntroducedToday(deckId: string, now: number): number {
  const row = db.prepare(
    "SELECT COUNT(DISTINCT card_id) AS n FROM review_log WHERE deck_id = ? AND state = 0 AND reviewed_at >= ?",
  ).get(deckId, startOfTodayMs(now)) as { n: number };
  return row.n ?? 0;
}

export function deckDueCounts(deckId: string, now: number): { due: number; new: number } {
  const row = db.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN s.due IS NOT NULL AND s.due <= ? AND s.state IN (1,2,3) THEN c.id END) AS due,
       COUNT(DISTINCT CASE WHEN s.card_id IS NULL THEN c.id END) AS new
     FROM cards c LEFT JOIN card_scheduling s ON s.card_id = c.id WHERE c.deck_id = ?`,
  ).get(now, deckId) as { due: number; new: number };
  return { due: row.due ?? 0, new: row.new ?? 0 };
}

export function allDeckDueCounts(now: number): { deckId: string; title: string; due: number; new: number }[] {
  return db.prepare(
    `SELECT d.id AS deckId, d.title AS title,
            COUNT(DISTINCT CASE WHEN s.due IS NOT NULL AND s.due <= ? AND s.state IN (1,2,3) THEN c.id END) AS due,
            COUNT(DISTINCT CASE WHEN s.card_id IS NULL THEN c.id END) AS new
     FROM decks d
     LEFT JOIN cards c ON c.deck_id = d.id
     LEFT JOIN card_scheduling s ON s.card_id = c.id
     GROUP BY d.id
     ORDER BY d.created_at DESC`,
  ).all(now) as { deckId: string; title: string; due: number; new: number }[];
}

// Per-deck session queue: due first (by due asc), then new (by ordinal) up to
// the remaining daily cap. newCap is daily_new_limit − newIntroducedToday.
export function dueCardsInDeck(deckId: string, now: number, newCap: number): CardDue[] {
  const deck = getDeck(deckId);
  const title = deck?.title ?? "";
  const due = db.prepare(
    `SELECT c.id, c.front, c.back, s.due, s.state
     FROM cards c JOIN card_scheduling s ON s.card_id = c.id
     WHERE c.deck_id = ? AND s.due <= ? AND s.state IN (1,2,3)
     ORDER BY s.due ASC`,
  ).all(deckId, now) as { id: string; front: string; back: string; due: number; state: number }[];
  const newLimit = Math.max(0, newCap);
  const fresh = db.prepare(
    `SELECT c.id, c.front, c.back, c.ordinal
     FROM cards c LEFT JOIN card_scheduling s ON s.card_id = c.id
     WHERE c.deck_id = ? AND s.card_id IS NULL
     ORDER BY c.ordinal ASC LIMIT ?`,
  ).all(deckId, newLimit) as { id: string; front: string; back: string; ordinal: number }[];
  const out: CardDue[] = due.map((r) => ({ id: r.id, front: r.front, back: r.back, deckId, deckTitle: title, state: r.state as CardState, due: r.due }));
  for (const r of fresh) out.push({ id: r.id, front: r.front, back: r.back, deckId, deckTitle: title, state: CardState.New, due: null });
  return out;
}

// Cross-deck queue: all due (by due asc) + new per deck capped by each deck's
// daily_new_limit − newIntroducedToday. New cards ordered by deck then ordinal.
export function dueCardsAllDecks(now: number): CardDue[] {
  const due = db.prepare(
    `SELECT c.id, c.front, c.back, c.deck_id, d.title AS deckTitle, s.due, s.state
     FROM cards c
     JOIN card_scheduling s ON s.card_id = c.id
     JOIN decks d ON d.id = c.deck_id
     WHERE s.due <= ? AND s.state IN (1,2,3)
     ORDER BY s.due ASC`,
  ).all(now) as { id: string; front: string; back: string; deck_id: string; deckTitle: string; due: number; state: number }[];
  const allFresh = db.prepare(
    `SELECT c.id, c.front, c.back, c.ordinal, c.deck_id, d.title AS deckTitle, d.daily_new_limit AS cap
     FROM cards c
     JOIN decks d ON d.id = c.deck_id
     LEFT JOIN card_scheduling s ON s.card_id = c.id
     WHERE s.card_id IS NULL
     ORDER BY c.deck_id, c.ordinal ASC`,
  ).all() as { id: string; front: string; back: string; ordinal: number; deck_id: string; deckTitle: string; cap: number }[];
  // Apply per-deck new cap (cap − introducedToday) in JS.
  const remaining = new Map<string, number>();
  const fresh: CardDue[] = [];
  for (const r of allFresh) {
    if (!remaining.has(r.deck_id)) {
      remaining.set(r.deck_id, Math.max(0, r.cap - newIntroducedToday(r.deck_id, now)));
    }
    const left = remaining.get(r.deck_id)!;
    if (left <= 0) continue;
    remaining.set(r.deck_id, left - 1);
    fresh.push({ id: r.id, front: r.front, back: r.back, deckId: r.deck_id, deckTitle: r.deckTitle, state: CardState.New, due: null });
  }
  const out: CardDue[] = due.map((r) => ({ id: r.id, front: r.front, back: r.back, deckId: r.deck_id, deckTitle: r.deckTitle, state: r.state as CardState, due: r.due }));
  for (const f of fresh) out.push(f);
  return out;
}