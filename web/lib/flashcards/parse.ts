// Pure parser for the ```flashcard fenced-block format. No React, no DB —
// importable from both the client (FlashcardDeck component) and the server
// (the /api/decks POST validation can reuse it if it ever needs to).
//
// Format:
//   # Deck title (optional, first line starting with "# ")
//   Q: front (markdown, may span multiple lines until the next Q:/A:)
//   A: back (markdown, may span multiple lines until the next Q:/A:)
//   Q: ...
//   A: ...
//
// Lines are split on a leading "Q:" or "A:" marker (case-sensitive, at line
// start, optionally followed by a space). A `Q:` opens a new card front; `A:`
// opens its back. Blank lines between cards are ignored. Pairs missing either
// half are dropped.

export interface Flashcard {
  front: string;
  back: string;
}

export interface ParsedFlashcards {
  title: string | null;
  cards: Flashcard[];
}

const MARKER = /^(Q|A):\s?/;

export function parseFlashcards(source: string): ParsedFlashcards {
  let title: string | null = null;
  let body = source;

  // An optional leading title line: "# Title". Only honor it if it's the first
  // non-blank line — a `#` mid-deck is treated as content.
  const firstLineEnd = source.indexOf("\n");
  const firstLine = (firstLineEnd === -1 ? source : source.slice(0, firstLineEnd)).trim();
  const titleMatch = /^#\s+(.+)$/.exec(firstLine);
  if (titleMatch) {
    title = titleMatch[1].trim();
    body = firstLineEnd === -1 ? "" : source.slice(firstLineEnd + 1);
  }

  // Walk the lines, accumulating the current front/back buffers. A `Q:` marker
  // flushes any in-progress card (Q+A) and starts a new front; an `A:` marker
  // switches to filling the back. Lines that aren't markers append to whatever
  // buffer is active (front or back), preserving multi-line content.
  const cards: Flashcard[] = [];
  let front: string[] | null = null;
  let back: string[] | null = null;

  const flush = () => {
    if (front !== null && back !== null) {
      const f = front.join("\n").trim();
      const b = back.join("\n").trim();
      if (f || b) cards.push({ front: f, back: b });
    }
    front = null;
    back = null;
  };

  for (const raw of body.split("\n")) {
    const m = MARKER.exec(raw);
    if (m) {
      const kind = m[1];
      const rest = raw.slice(m[0].length);
      if (kind === "Q") {
        flush();
        front = [rest];
        back = null;
      } else {
        // A: — if no front is open yet (stray A:), start an empty front so the
        // pair still parses with an empty front.
        if (front === null) front = [];
        back = [rest];
      }
    } else if (front !== null || back !== null) {
      // Content line belonging to the active buffer. Only accumulate once a
      // marker has opened a card (ignore leading blank/stray lines).
      const target = back !== null ? back : front!;
      target.push(raw);
    }
    // Lines before the first Q: (other than the title) are ignored.
  }
  flush();

  return { title, cards };
}