import { NextResponse } from "next/server";
import { extractPdf } from "@/lib/ingest";

// Text-like extensions we will inline into a chat message. Anything else is
// rejected so the picker/server stay in sync (the client picker uses the same
// list). PDFs go through unpdf; the rest are read as UTF-8.
const TEXT_EXT = [
  "pdf", "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java",
  "kt", "c", "cc", "cpp", "h", "hpp", "cs", "php", "swift", "sh", "bash",
  "sql", "html", "htm", "css", "scss", "toml", "ini", "env", "log", "xml",
];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB cap on uploaded chat attachments
// Cap on the extracted text length. An 8 MB text file is already ~8M chars, but
// a PDF can decompress into far more text than its byte size suggests (a small
// file of repeated objects / decompression bombs). Truncating here bounds the
// inlined context and the request body sent to the model on every turn.
const MAX_CHARS = 250_000;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

// POST /api/extract — multipart { file }. Extracts text from a single text-like
// file so the client can inline it into the next chat message. PDFs use the
// same unpdf path as materials ingestion; everything else is decoded as UTF-8.
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 400 });
  }
  const ext = extOf(file.name);
  if (!TEXT_EXT.includes(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type: .${ext || "?"}` },
      { status: 400 },
    );
  }

  try {
    let text: string;
    if (ext === "pdf") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      text = (await extractPdf(bytes)).text ?? "";
    } else {
      text = await file.text();
    }
    // PDF decompression can blow past the 8 MB upload cap; bound the extracted
    // text so a decompression-bomb PDF can't flood the model's context.
    const truncated = text.length > MAX_CHARS;
    if (truncated) text = text.slice(0, MAX_CHARS);
    return NextResponse.json({
      name: file.name,
      text,
      charCount: text.length,
      ...(truncated ? { truncated: true, maxChars: MAX_CHARS } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 502 },
    );
  }
}