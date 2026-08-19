import { extractText, getMeta, getDocumentProxy } from "unpdf";
import { convert as htmlToText } from "html-to-text";
import { updateMaterialStatus, addChunks } from "@/lib/db/materials";
import { embedManyTexts, encodeEmbedding } from "@/lib/embed";
import { safeFetch } from "./ssrf";

const TARGET = 800;
const OVERLAP = 100;

// --- Extraction helpers (called by the materials route) ----------------------

export async function extractPdf(
  bytes: Uint8Array,
): Promise<{ text: string; title?: string; pages: { page: number; text: string }[] }> {
  // unpdf exposes `extractText` (not `extractPdf`) and a separate `getMeta`
  // for document metadata. Reuse one parsed document proxy for both calls so we
  // don't parse the file twice.
  const pdf = await getDocumentProxy(bytes);
  const extracted = await extractText(pdf);
  const rawPages = Array.isArray(extracted.text) ? extracted.text : [extracted.text ?? ""];
  const pages = rawPages.map((text, index) => ({ page: index + 1, text: text ?? "" }));
  const text = pages.map((page) => page.text).join("\n\n");
  let title: string | undefined;
  try {
    const { info } = await getMeta(pdf);
    const t = info?.Title;
    title = typeof t === "string" && t.trim() ? t.trim() : undefined;
  } catch {
    // Metadata is best-effort; ignore failures.
  }
  return { text, title, pages };
}

export async function extractUrl(
  url: string,
): Promise<{ text: string; title?: string }> {
  // SSRF guard: scheme allow-list + private/loopback/link-local/metadata
  // range blocking on every resolved address, with manual redirect handling
  // so a public URL can't 302 to an internal host. See lib/ingest/ssrf.ts.
  // Residual (documented there): DNS rebinding is not fully closed.
  const res = await safeFetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "StudyGPT/1.0 (study companion)" },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  const html = await res.text();
  const text = htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "nav", format: "skip" },
      { selector: "footer", format: "skip" },
    ],
  });
  // Best-effort <title> extraction; fall back to undefined.
  let title: string | undefined;
  try {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    title = titleMatch?.[1]?.trim() || undefined;
  } catch {
    title = undefined;
  }
  return { text, title };
}

// --- Paragraph-based chunking with overlap -----------------------------------
// Split on blank lines, split oversized paragraphs at sentence boundaries, and
// greedily merge into chunks <= TARGET chars while carrying OVERLAP chars of the
// previous chunk's tail into the next so adjacent chunks share context.
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const paragraphs = clean
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
  return chunks.filter((c) => c.length > 0);
}

export function chunkPages(
  pages: { page: number; text: string }[],
): { text: string; loc: { page: number } }[] {
  return pages.flatMap((page) =>
    chunkText(page.text).map((chunk) => ({ text: chunk, loc: { page: page.page } })),
  );
}

// --- Ingestion: chunk, embed, store, set status ------------------------------
// Text-centric: the route has already extracted text (via extractPdf/extractUrl
// or otherwise). We chunk it, embed in batches, persist the chunks, and flip the
// material to `ready` (with charCount + text) or `error` (with a message) so a
// material is never left stuck in `processing`.
export async function ingestFromText(
  materialId: string,
  text: string,
  opts?: { pages?: { page: number; text: string }[] },
): Promise<void> {
  try {
    const chunkRecords = opts?.pages?.length
      ? chunkPages(opts.pages)
      : chunkText(text).map((chunk) => ({ text: chunk, loc: null }));
    if (chunkRecords.length === 0) {
      updateMaterialStatus(materialId, "error", {
        error: "No text could be extracted.",
      });
      return;
    }
    const embeddings = await embedManyTexts(chunkRecords.map((chunk) => chunk.text));
    // Insert all chunks in one transaction so a mid-loop failure leaves no
    // partial chunks. A throw propagates to the catch → updateMaterialStatus(error).
    addChunks(
      materialId,
      chunkRecords.map((chunk, i) => ({
        text: chunk.text,
        embedding: encodeEmbedding(embeddings[i]),
        ordinal: i,
        page: chunk.loc?.page ?? null,
      })),
    );
    updateMaterialStatus(materialId, "ready", { charCount: text.length, text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ingestion failed";
    updateMaterialStatus(materialId, "error", { error: msg });
  }
}
