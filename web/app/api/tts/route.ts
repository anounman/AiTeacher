import { NextResponse } from "next/server";
import models from "@/config/models.json";
import {
  EXPRESSION_PROFILES,
  isTeachingExpression,
  type TeachingExpression,
} from "@/lib/teach/expression";

// Proxy to Kokoro TTS (OpenAI-compatible /audio/speech). Server-side so the
// Tailscale host stays out of the browser and CORS never applies. GET lists
// voices. 503 when Kokoro is unreachable — the client falls back to the
// browser's speechSynthesis.
const CFG = models.tts as {
  url: string;
  model: string;
  voice: string;
  speed: number;
  format: string;
};

const base = process.env.KOKORO_URL || CFG.url;

const KOKORO_MIN_SPEED = 0.25;
const KOKORO_MAX_SPEED = 4;

type TtsRequestBody = {
  text?: unknown;
  voice?: unknown;
  /** Backwards-compatible absolute provider speed. Prefer `rate`. */
  speed?: unknown;
  /** Multiplier relative to the configured speed. */
  rate?: unknown;
  expression?: unknown;
};

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveSpeed(body: TtsRequestBody, expression?: TeachingExpression): number | null {
  // Keep the existing `speed` contract absolute. The new `rate` is a portable
  // multiplier, so changing the configured baseline still affects all voices.
  const speed = body.rate !== undefined
    ? validNumber(body.rate) ? CFG.speed * body.rate : NaN
    : body.speed !== undefined
      ? validNumber(body.speed) ? body.speed : NaN
      : expression
        ? CFG.speed * EXPRESSION_PROFILES[expression].rate
        : CFG.speed;

  return speed >= KOKORO_MIN_SPEED && speed <= KOKORO_MAX_SPEED ? speed : null;
}

export async function GET() {
  try {
    const res = await fetch(`${base}/audio/voices`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { voices?: { id: string }[] };
    return NextResponse.json({
      available: true,
      voice: CFG.voice,
      voices: (data.voices ?? []).map((v) => v.id),
    });
  } catch {
    return NextResponse.json({ available: false, voices: [] });
  }
}

export async function POST(req: Request) {
  let body: TtsRequestBody;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "bad body" }, { status: 400 });
    }
    body = parsed as TtsRequestBody;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });

  const expression = body.expression === undefined
    ? undefined
    : isTeachingExpression(body.expression)
      ? body.expression
      : null;
  if (expression === null) {
    return NextResponse.json({ error: "invalid expression" }, { status: 400 });
  }

  const speed = resolveSpeed(body, expression);
  if (speed === null) {
    return NextResponse.json(
      { error: `speed/rate must produce a speed from ${KOKORO_MIN_SPEED} to ${KOKORO_MAX_SPEED}` },
      { status: 400 },
    );
  }

  const voice = body.voice === undefined
    ? CFG.voice
    : typeof body.voice === "string" && body.voice.trim() && body.voice.length <= 120
      ? body.voice.trim()
      : null;
  if (voice === null) return NextResponse.json({ error: "invalid voice" }, { status: 400 });

  try {
    // The configured Kokoro-FastAPI v0.7.2 schema supports speed and
    // volume_multiplier, but not OpenAI's newer `instructions` field. Map the
    // provider-neutral expression onto those supported controls only.
    const expressionOptions = expression
      ? { volume_multiplier: EXPRESSION_PROFILES[expression].volume }
      : {};
    const res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CFG.model,
        voice,
        input: text,
        speed,
        response_format: CFG.format,
        ...expressionOptions,
      }),
      // A long spoken segment on the CPU image can take a while.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `kokoro ${res.status}` }, { status: 502 });
    }
    return new Response(res.body, {
      headers: {
        "Content-Type": CFG.format === "mp3" ? "audio/mpeg" : `audio/${CFG.format}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "kokoro unreachable" }, { status: 503 });
  }
}
