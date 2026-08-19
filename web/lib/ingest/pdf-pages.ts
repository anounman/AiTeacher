import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Document, Matrix, ColorSpace } from "mupdf";

// Render each PDF page to a JPEG and store it on disk, keyed by material id +
// 1-indexed page number. These page images are the durable, "see the notation"
// artifact fed to a vision model on diagram turns (the slide PDFs embed ER /
// diagram notation as images that text extraction loses). JPEG (not PNG) keeps
// the per-page payload small enough to attach several pages to one model call.
//
// Storage layout: data/pages/<materialId>/<page>.jpg  (1-indexed page).
// `data/` is the same dir that holds studygpt.db. Best-effort: callers catch
// errors so a render failure never blocks text ingestion.
//
// The source PDF itself is also retained at data/uploads/<materialId>.pdf so
// page images can be (re-)rendered on demand — without it, a one-shot render
// failure or a feature added after upload leaves the material with no page
// images and no way to recover short of re-uploading the file.

const PAGES_DIR = resolve(process.cwd(), "data", "pages");
const UPLOADS_DIR = resolve(process.cwd(), "data", "uploads");
// Render scale (PDF points → pixels). 2x gives ~1440–2000px slides: crisp enough
// for a vision model to read notation + labels, modest JPEG size.
const RENDER_SCALE = 2;
// JPEG quality: high enough to preserve diagram edges + legible labels, low
// enough that a page is a few hundred KB.
const JPEG_QUALITY = 85;
// Cap pages rendered per material so a giant PDF can't blow up disk + ingest
// time. Most slide decks are < 80 pages.
const MAX_PAGES = 80;

function materialDir(materialId: string): string {
  return resolve(PAGES_DIR, materialId);
}

export function pageImagePath(materialId: string, page: number): string {
  return resolve(materialDir(materialId), `${page}.jpg`);
}

// --- Source PDF retention ----------------------------------------------------

export function sourcePdfPath(materialId: string): string {
  return resolve(UPLOADS_DIR, `${materialId}.pdf`);
}

// Is the original PDF for this material retained on disk?
export function hasSourcePdf(materialId: string): boolean {
  try {
    return existsSync(sourcePdfPath(materialId));
  } catch {
    return false;
  }
}

// Load the retained source PDF bytes, or null if it isn't on disk.
export function loadSourcePdf(materialId: string): Buffer | null {
  try {
    const p = sourcePdfPath(materialId);
    return existsSync(p) ? readFileSync(p) : null;
  } catch {
    return null;
  }
}

// Persist the source PDF for a material so page images can be re-rendered on
// demand (lazy render, heal-on-reupload, future re-extraction). Idempotent —
// overwrites any prior copy.
export function saveSourcePdf(materialId: string, bytes: Uint8Array): void {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  writeFileSync(sourcePdfPath(materialId), Buffer.from(bytes));
}

// Does this material have any rendered page images on disk? Cheap dir check —
// used by the chat route to decide whether a diagram turn can go down the
// vision path at all. A material with a dir but zero JPEGs (a partial/failed
// render) is treated as NOT having page images so ensurePageImages re-renders.
export function hasPageImages(materialId: string): boolean {
  try {
    const dir = materialDir(materialId);
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((f) => f.endsWith(".jpg"));
  } catch {
    return false;
  }
}

// Make sure page images exist for a material: if they're missing AND the source
// PDF is retained on disk, render them now. Returns true if page images are
// available after the call (either they already existed, or we just rendered
// them). Returns false if there's no source PDF to render from — the caller
// then falls back to the text-only path. This is the "just works" hook: any
// material whose PDF was retained gets its page images lazily on the first
// diagram turn that needs them, with no re-upload.
export async function ensurePageImages(materialId: string): Promise<boolean> {
  if (hasPageImages(materialId)) return true;
  const bytes = loadSourcePdf(materialId);
  if (!bytes) return false;
  try {
    await renderPdfPages(new Uint8Array(bytes), materialId);
    return hasPageImages(materialId);
  } catch (e) {
    console.error(`[ensurePageImages] ${materialId} render failed:`, e instanceof Error ? e.message : e);
    return false;
  }
}

// Load a single page image as a Buffer, or null if it isn't on disk.
export function loadPageImage(materialId: string, page: number): Buffer | null {
  try {
    const p = pageImagePath(materialId, page);
    return existsSync(p) ? readFileSync(p) : null;
  } catch {
    return null;
  }
}

// The 1-indexed page numbers that have a rendered JPEG on disk, sorted. Used by
// the notation pipeline's spread fallback: when retrieved chunks have no usable
// page mapping (e.g. old decks ingested before page boundaries were preserved),
// we send a representative spread of the deck's pages so the vision model can
// still see the course's diagram notation.
export function listPageImages(materialId: string): number[] {
  try {
    const dir = materialDir(materialId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /^\d+\.jpg$/i.test(f))
      .map((f) => parseInt(f, 10))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

// Remove all page images for a material (called on material delete so we don't
// orphan JPEGs when their material row goes away).
export function deletePageImages(materialId: string): void {
  try {
    const dir = materialDir(materialId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; never throw from a delete path.
  }
}

// Remove the retained source PDF for a material (called on material delete).
export function deleteSourcePdf(materialId: string): void {
  try {
    const p = sourcePdfPath(materialId);
    if (existsSync(p)) rmSync(p, { force: true });
  } catch {
    // Best-effort cleanup; never throw from a delete path.
  }
}

// Render every page of a PDF to a JPEG under data/pages/<materialId>/. Returns
// the list of page numbers written (1-indexed). Throws on failure; the caller
// is expected to `.catch(() => {})` so text ingestion still succeeds.
export async function renderPdfPages(bytes: Uint8Array, materialId: string): Promise<number[]> {
  const dir = materialDir(materialId);
  mkdirSync(dir, { recursive: true });

  const doc = Document.openDocument(bytes, "pdf");
  try {
    const count = Math.min(doc.countPages(), MAX_PAGES);
    const matrix = Matrix.scale(RENDER_SCALE, RENDER_SCALE);
    const written: number[] = [];
    for (let i = 0; i < count; i++) {
      const page = doc.loadPage(i);
      try {
        // alpha=false → opaque white background, smaller JPEG, no transparency
        // artifacts in the vision payload.
        const pixmap = page.toPixmap(matrix, ColorSpace.DeviceRGB, false);
        try {
          const jpg = pixmap.asJPEG(JPEG_QUALITY);
          // Copy into a fresh Buffer: mupdf returns a Uint8Array backed by WASM
          // memory that may be neutered after the pixmap is freed. Buffer.from
          // copies so the bytes outlive the pixmap.
          const buf = Buffer.from(jpg);
          const out = resolve(dir, `${i + 1}.jpg`);
          writeFileSync(out, buf);
          written.push(i + 1);
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    return written;
  } finally {
    doc.destroy();
  }
}