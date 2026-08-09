import { z } from "zod";
import { visualPlanSchema } from "./visual-schema";

// The teach-mode wire protocol: the model streams markdown where short spoken
// prose segments alternate with ```board fences containing a JSON array of
// TeachActions. The client speaks the prose (TTS) and animates the actions
// onto the board, in document order. See ARCHITECTURE.md §8 (Teach loop).

const placeSchema = z
  .object({
    anchor: z.enum(["below", "right_of", "new_section"]).optional(),
    ref: z.string().optional(),
  })
  .optional();

export const teachActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string(), id: z.string().optional() }),
  // `tex` is raw LaTeX with NO $ delimiters — rendered via MathJax display mode.
  // Sub-expressions wrapped in \cssId{<part>}{...} become mark targets.
  z.object({ type: z.literal("latex"), tex: z.string(), id: z.string().optional(), place: placeSchema }),
  z.object({ type: z.literal("text"), text: z.string(), id: z.string().optional(), place: placeSchema }),
  // Handwritten board content via the mathwriter engine (markup: fractions
  // [F]a|b[/F], roots [R]x[/R], sums/integrals, matrices — see MARKUP.md).
  // The primary way the teacher writes. Lines markable: target "id:L<n>".
  z.object({
    type: z.literal("write"),
    markup: z.string(),
    id: z.string().optional(),
    color: z.enum(["ink", "red", "blue"]).default("ink"),
  }),
  // Source code — typeset monospace, typed out line by line. NEVER goes
  // through MathJax. Lines are markable: target "codeId:L<n>" (0-based).
  z.object({ type: z.literal("code"), code: z.string(), lang: z.string().optional(), id: z.string().optional() }),
  // Hand-drawn annotation over part of an earlier equation: target "eqId#partId"
  // (partId from \cssId) or just "eqId" for the whole equation.
  z.object({
    type: z.literal("mark"),
    target: z.string(),
    style: z.enum(["circle", "underline", "box"]).default("circle"),
    label: z.string().optional(),
    color: z.enum(["red", "blue", "ink"]).default("red"),
  }),
  z.object({ type: z.literal("arrow"), from: z.string(), to: z.string(), label: z.string().optional() }),
  z.object({ type: z.literal("box"), around: z.string() }),
  // A versioned scene authored by the visual-director model. The nested
  // semantic action names are deliberately independent of concrete artwork,
  // so a future asset dataset can replace placeholders without changing old
  // lessons or the model contract.
  z.object({ type: z.literal("visual_scene"), plan: visualPlanSchema }),
  z.object({ type: z.literal("new_page") }),
]);

export type TeachAction = z.infer<typeof teachActionSchema>;

export type TeachEvent =
  | { kind: "speak"; text: string }
  | { kind: "draw"; action: TeachAction };

export type TranscriptPart =
  | { kind: "speak"; text: string; from: number; to: number }
  | { kind: "steps"; n: number; from: number; to: number };

// Fence body → validated actions. Tolerant: invalid JSON → [], invalid
// entries dropped individually so one bad action doesn't kill the step.
export function parseBoardFence(body: string): TeachAction[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: TeachAction[] = [];
  for (const entry of raw) {
    const parsed = teachActionSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

// Parse the (possibly still-streaming) markdown into an ordered event list.
// CRITICAL invariant for the orchestrator: successive calls on a growing
// string must return a stable prefix — an event once emitted at index i is
// identical on every later parse. Completed sentences and closed fences never
// change; the trailing partial sentence is withheld until it completes (or
// `done`), and an unclosed fence is withheld entirely.
export function parseTeachEvents(md: string, done: boolean): TeachEvent[] {
  const events: TeachEvent[] = [];

  const pushProse = (text: string, complete: boolean) => {
    const sentences = text.split(SENTENCE_SPLIT);
    const last = sentences.length - 1;
    sentences.forEach((s, i) => {
      const trimmed = s.trim();
      if (!trimmed) return;
      if (i < last || complete) events.push({ kind: "speak", text: trimmed });
    });
  };

  const fenceRe = /```board[^\n]*\n([\s\S]*?)```/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(md))) {
    pushProse(md.slice(cursor, m.index), true);
    for (const action of parseBoardFence(m[1] ?? "")) events.push({ kind: "draw", action });
    cursor = m.index + m[0].length;
  }

  const tail = md.slice(cursor);
  const openFence = tail.indexOf("```board");
  const prose = openFence >= 0 ? tail.slice(0, openFence) : tail;
  pushProse(prose, done || openFence >= 0);

  return events;
}

// Turn the same event sequence used by the voice/board performer into chat
// transcript rows. Consecutive board actions stay compact, but retain their
// exact event range so the row can highlight with the shared performer cursor.
export function toTranscriptParts(events: TeachEvent[]): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.kind === "speak") {
      parts.push({ kind: "speak", text: event.text, from: i, to: i + 1 });
      continue;
    }
    const last = parts[parts.length - 1];
    if (last?.kind === "steps" && last.to === i) {
      last.n += 1;
      last.to = i + 1;
    } else {
      parts.push({ kind: "steps", n: 1, from: i, to: i + 1 });
    }
  }
  return parts;
}

// Prose → something a TTS voice can say: strip markdown syntax, residual
// math, bracketed citation markers, and collapse whitespace. The teach prompt
// forbids math in prose, so this is a safety net, not a verbalizer.
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]*\$/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[#*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
