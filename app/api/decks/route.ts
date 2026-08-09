import { NextResponse } from "next/server";
import { createDeck, listDecksWithCounts } from "@/lib/db";

// GET /api/decks — list all saved decks with card counts (newest first).
export async function GET() {
  return NextResponse.json(listDecksWithCounts());
}

// POST /api/decks — save a deck. Body: { title, cards: [{front, back}], conversationId? }
export async function POST(req: Request) {
  const { title, cards, conversationId } = await req.json().catch(() => ({}));
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (
    !Array.isArray(cards) ||
    cards.length === 0 ||
    !cards.every(
      (c) =>
        c && typeof c === "object" && typeof c.front === "string" && typeof c.back === "string",
    )
  ) {
    return NextResponse.json({ error: "cards required (non-empty, each {front, back})" }, { status: 400 });
  }
  const deck = createDeck(
    title.trim(),
    cards.map((c) => ({ front: c.front.trim(), back: c.back.trim() })),
    typeof conversationId === "string" ? conversationId : null,
  );
  return NextResponse.json(deck, { status: 201 });
}