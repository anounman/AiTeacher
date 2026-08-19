// Pure text chunking — no DB, no embedding, no I/O. Extracted from
// ingest/index.ts so it can be reused by the chunk-page back-fill migration
// (lib/db/index.ts) WITHOUT a circular import (ingest/index.ts imports the db;
// the db migration must not import ingest/index.ts).
//
// Split on form feeds (PDF page breaks) first, then within each section split
// on blank lines, split oversized paragraphs at sentence boundaries, and
// greedily merge into chunks <= TARGET chars while carrying OVERLAP chars of
// the previous chunk's tail into the next so adjacent chunks share context.
// Scoping to a form-feed section means a chunk never spans two pages — slide
// decks render as one slide per page, and merging across the boundary would
// mix two slides' content into one low-signal chunk. Prose sources have no
// form feed, so the whole text is one section and behavior is unchanged.
// Each chunk carries the 1-indexed PDF page it came from (the form-feed
// section index). A page may yield multiple chunks, all tagged with that
// page. The diagram notation pipeline uses chunk.page to load the matching
// slide page image (see lib/ingest/pdf-pages.ts).

const TARGET = 1500;
const OVERLAP = 150;

export function chunkText(text: string): { text: string; page: number }[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const sections = clean.split(/\f/).map((s) => s.trim()).filter(Boolean);
  const chunks: { text: string; page: number }[] = [];
  for (let i = 0; i < sections.length; i++) {
    const page = i + 1; // 1-indexed PDF page
    for (const c of chunkSection(sections[i])) chunks.push({ text: c, page });
  }
  return chunks.filter((c) => c.text.length > 0);
}

function chunkSection(section: string): string[] {
  const paragraphs = section
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Further split very long paragraphs at sentence boundaries.
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= TARGET * 1.5) {
      pieces.push(p);
    } else {
      const sentences = p.split(/(?<=[.!?])\s+/);
      let buf = "";
      for (const s of sentences) {
        if (buf && (buf + " " + s).trim().length > TARGET) {
          pieces.push(buf.trim());
          buf = s;
        } else {
          buf = (buf ? buf + " " : "") + s;
        }
      }
      if (buf.trim()) pieces.push(buf.trim());
    }
  }

  // Greedily merge pieces into chunks <= TARGET, carrying OVERLAP into the next.
  const chunks: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (cur && (cur + "\n\n" + piece).length > TARGET) {
      chunks.push(cur);
      const tail = cur.slice(-OVERLAP);
      cur = tail ? tail + "\n\n" + piece : piece;
    } else {
      cur = cur ? cur + "\n\n" + piece : piece;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}