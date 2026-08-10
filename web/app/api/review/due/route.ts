import { NextResponse } from "next/server";
import { dueCardsAllDecks, allDeckDueCounts } from "@/lib/db";
import { cardMastery } from "@/lib/db/mastery";

// GET /api/review/due — cross-deck queue + per-deck counts for the /review page.
export async function GET() {
  const now = Date.now();
  const cards = dueCardsAllDecks(now).map((c) => {
    const m = cardMastery(c.id, now);
    return { ...c, mastery: m?.mastery ?? null, band: m?.band };
  });
  return NextResponse.json({ cards, decks: allDeckDueCounts(now) });
}