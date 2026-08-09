import { db } from "./index";
import type { Deck, Card } from "./schema";

export function listDecks(): Deck[] {
  return db
    .prepare("SELECT * FROM decks ORDER BY created_at DESC")
    .all() as Deck[];
}

// All decks with their card counts in one query (LEFT JOIN + COUNT), so the
// /decks list page doesn't fan out a getCards call per deck. The count column
// is adjoined onto the Deck row shape as `card_count`.
export function listDecksWithCounts(): (Deck & {
  card_count: number; due: number; new: number; daily_new_limit: number;
})[] {
  return db
    .prepare(
      `SELECT d.*,
              COUNT(DISTINCT c.id) AS card_count,
              COUNT(DISTINCT CASE WHEN s.due IS NOT NULL AND s.due <= @now AND s.state IN (1,2,3) THEN c.id END) AS due,
              COUNT(DISTINCT CASE WHEN s.card_id IS NULL THEN c.id END) AS new
       FROM decks d
       LEFT JOIN cards c ON c.deck_id = d.id
       LEFT JOIN card_scheduling s ON s.card_id = c.id
       GROUP BY d.id
       ORDER BY d.created_at DESC`,
    )
    .all({ now: Date.now() }) as (Deck & {
      card_count: number; due: number; new: number; daily_new_limit: number;
    })[];
}

export function getDeck(id: string): Deck | null {
  return (db.prepare("SELECT * FROM decks WHERE id = ?").get(id) as Deck | undefined) ?? null;
}

export function getCard(cardId: string): Card | null {
  return (db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as Card | undefined) ?? null;
}

export function getCards(deckId: string): Card[] {
  return db
    .prepare("SELECT * FROM cards WHERE deck_id = ? ORDER BY ordinal ASC")
    .all(deckId) as Card[];
}

export function getDeckWithCards(id: string): {
  deck: Deck; cards: Card[]; due: number; new: number; dailyCap: number;
  newIntroducedToday: number; lastReviewed: number | null;
} | null {
  const deck = getDeck(id);
  if (!deck) return null;
  const cards = getCards(id);
  const now = Date.now();
  const dueRow = db.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN s.due IS NOT NULL AND s.due <= ? AND s.state IN (1,2,3) THEN c.id END) AS due,
       COUNT(DISTINCT CASE WHEN s.card_id IS NULL THEN c.id END) AS new
     FROM cards c LEFT JOIN card_scheduling s ON s.card_id = c.id WHERE c.deck_id = ?`,
  ).get(now, id) as { due: number; new: number };
  const lastRow = db.prepare(
    "SELECT MAX(reviewed_at) AS last FROM review_log WHERE deck_id = ?",
  ).get(id) as { last: number | null };
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const introRow = db.prepare(
    "SELECT COUNT(DISTINCT card_id) AS n FROM review_log WHERE deck_id = ? AND state = 0 AND reviewed_at >= ?",
  ).get(id, startToday.getTime()) as { n: number };
  return {
    deck, cards,
    due: dueRow.due ?? 0,
    new: dueRow.new ?? 0,
    dailyCap: deck.daily_new_limit,
    newIntroducedToday: introRow.n ?? 0,
    lastReviewed: lastRow.last ?? null,
  };
}

// Insert a deck and all its cards in a single transaction so a mid-loop failure
// leaves no orphan cards. `cards` carry front/back markdown; ordinal is taken
// from array position. Returns the new deck row.
export function createDeck(
  title: string,
  cards: { front: string; back: string }[],
  conversationId?: string | null,
): Deck {
  const deck: Deck = {
    id: crypto.randomUUID(),
    title,
    conversation_id: typeof conversationId === "string" ? conversationId : null,
    daily_new_limit: 20,
    created_at: Date.now(),
  };
  const insertDeck = db.prepare(
    "INSERT INTO decks (id, title, conversation_id, created_at) VALUES (?, ?, ?, ?)",
  );
  const insertCard = db.prepare(
    "INSERT INTO cards (id, deck_id, front, back, ordinal, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const run = db.transaction((rows: { front: string; back: string; ordinal: number }[]) => {
    const now = deck.created_at;
    insertDeck.run(deck.id, deck.title, deck.conversation_id, now);
    rows.forEach((r, i) => {
      insertCard.run(crypto.randomUUID(), deck.id, r.front, r.back, i, now + i);
    });
  });
  run(cards.map((c, i) => ({ front: c.front, back: c.back, ordinal: i })));
  return deck;
}

export function renameDeck(id: string, title: string): void {
  db.prepare("UPDATE decks SET title = ? WHERE id = ?").run(title, id);
}

// ON DELETE CASCADE drops the deck's cards.
export function deleteDeck(id: string): void {
  db.prepare("DELETE FROM decks WHERE id = ?").run(id);
}