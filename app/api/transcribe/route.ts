import { NextResponse } from "next/server";
import { getModelConfig } from "@/lib/llm/provider";

// Voice typing: the client records a short clip with MediaRecorder and POSTs
// it here; this route forwards it to OpenAI's Whisper transcription endpoint.
// Keeping the proxy server-side means the OpenAI key never reaches the browser
// (and OpenAI's API isn't browser-CORS-able anyway). When no key is configured,
// the client falls back to the browser's built-in Web Speech API.

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIPTION_MODEL = "whisper-1";

// GET /api/transcribe — tells the client whether OpenAI transcription is
// available, so the composer picks the MediaRecorder path vs. Web Speech.
export async function GET() {
  const cfg = getModelConfig();
  return NextResponse.json({ available: !!cfg.openaiApiKey });
}

// POST /api/transcribe — multipart/form-data with an `audio` File part.
// Returns { text }. Errors: { error } with a 4xx/5xx status.
export async function POST(req: Request) {
  const cfg = getModelConfig();
  if (!cfg.openaiApiKey) {
    return NextResponse.json({ error: "Voice transcription is not configured. Add an OpenAI API key in Settings." }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No audio provided." }, { status: 400 });
  }

  const upstream = new FormData();
  // Whisper infers format from the filename extension; MediaRecorder on
  // Chromium produces audio/webm, so name it accordingly.
  const name = file.name || "audio.webm";
  upstream.append("file", file, name);
  upstream.append("model", TRANSCRIPTION_MODEL);
  upstream.append("response_format", "json");

  try {
    const res = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.openaiApiKey}` },
      body: upstream,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Transcription failed (${res.status}). ${detail.slice(0, 200)}` },
        { status: res.status },
      );
    }
    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ text: (data.text ?? "").trim() });
  } catch {
    return NextResponse.json({ error: "Could not reach the transcription service." }, { status: 502 });
  }
}