import { NextResponse } from "next/server";
import { generateText } from "ai";
import { slotModel } from "@/lib/llm/slots";

// POST /api/teach/read-ink — { png: dataURL, context?: string }.
// Reads the student's handwritten pen strokes with the `read` slot (a cloud
// vision model — always warm, ~2s; raced against the alternatives on real
// handwriting) and returns a faithful transcription (Phase 4.1 ask-pen). The
// caller folds the transcription into a normal teach interruption, where the
// reason model — which has the lesson — judges the answer.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  let body: { png?: unknown; context?: unknown };
  try {
    body = (await req.json()) as { png?: unknown; context?: unknown };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const png = typeof body.png === "string" ? body.png : "";
  if (!png.startsWith("data:image/png;base64,") || png.length > MAX_BYTES) {
    return NextResponse.json({ error: "png must be a data:image/png;base64 URL under 4 MB" }, { status: 400 });
  }
  const context = typeof body.context === "string" ? body.context.slice(0, 500) : "";

  try {
    const result = await generateText({
      model: slotModel("read"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "This image is a student's handwritten answer, written with a stylus on a whiteboard." +
                (context ? ` Context: ${context}.` : "") +
                " Transcribe EXACTLY what is written — math notation as plain text (fractions as a/b, exponents as ^)." +
                " If there is a drawing or diagram, describe its structure in one short sentence." +
                " Output only the transcription/description, no commentary. If the image is blank or unreadable, output UNREADABLE.",
            },
            { type: "image", image: png },
          ],
        },
      ],
      maxOutputTokens: 300,
      maxRetries: 1,
      abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]),
    });
    const text = result.text.trim();
    return NextResponse.json({ text: /^UNREADABLE\b/.test(text) ? "" : text });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "vision read failed" },
      { status: 502 },
    );
  }
}
