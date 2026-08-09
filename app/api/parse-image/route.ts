import { NextResponse } from "next/server";
import { createWorker, type Worker } from "tesseract.js";

// POST /api/parse-image — multipart { file }. OCRs an image to text via
// tesseract.js so non-vision chat models can still ingest images (the parsing
// layer): the client stores the returned text on the attachment, and the chat
// route inlines it in place of an image part when the active model isn't
// vision-capable. Vision-capable models still receive the raw image part.
//
// Performance: we keep ONE tesseract worker alive for the process (cached on
// globalThis to survive Next dev HMR) instead of `Tesseract.recognize`, which
// spawns a worker + reloads `eng.traineddata` on every call — that per-call
// load was the dominant cost. Recognition still takes time on large images,
// so the client also downscales to ~1600px before uploading. A single shared
// worker serializes concurrent OCRs; fine for a single-user local app.
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB cap, same as /api/extract

const globalForOcr = globalThis as unknown as { __ocrWorker?: Promise<Worker> };

function getWorker(): Promise<Worker> {
  if (!globalForOcr.__ocrWorker) {
    // createWorker('eng') loads the wasm core + eng traineddata once and keeps
    // the worker resident for reuse across requests.
    globalForOcr.__ocrWorker = createWorker("eng");
  }
  return globalForOcr.__ocrWorker;
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Not an image" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Image too large (max ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    const text = (data?.text ?? "").trim();
    return NextResponse.json({ text, charCount: text.length });
  } catch (err) {
    // OCR failure is non-fatal: return empty text so the send proceeds with a
    // "(no text detected)" placeholder rather than a hard error.
    return NextResponse.json({
      text: "",
      charCount: 0,
      warning: err instanceof Error ? err.message : "OCR failed",
    });
  }
}