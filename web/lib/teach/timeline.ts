import type { TeachEvent } from "./protocol";

// A lesson is performed as beats: narration followed by the board actions it
// explains.  Keeping the cue plan pure makes the timing policy deterministic
// and leaves TeachStage responsible only for clocks, pausing, and rendering.

export interface SpeechCue {
  event: Extract<TeachEvent, { kind: "speak" }>;
  eventIndex: number;
  atMs: number;
  estimatedDurationMs: number;
}

export interface DrawCue {
  event: Extract<TeachEvent, { kind: "draw" }>;
  eventIndex: number;
  atMs: number;
}

export interface LessonBeat {
  from: number;
  to: number;
  estimatedDurationMs: number;
  speech: SpeechCue[];
  draws: DrawCue[];
}

const MIN_SPEECH_MS = 850;
const MAX_SPEECH_MS = 12_000;
const MS_PER_WORD = 335;
const DRAW_ONLY_CADENCE_MS = 650;
const MIN_CAMERA_CUE_GAP_MS = 520;

export function estimateSpeechDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // A small punctuation allowance stops short explanatory sentences from
  // feeling rushed without making long paragraphs increasingly inaccurate.
  const punctuationPauses = (text.match(/[,;:—]/g) ?? []).length * 90;
  return Math.max(
    MIN_SPEECH_MS,
    Math.min(MAX_SPEECH_MS, words * MS_PER_WORD + punctuationPauses + 180),
  );
}

function planBeat(events: TeachEvent[], from: number, to: number): LessonBeat {
  const speech: SpeechCue[] = [];
  const drawEvents: Array<{ event: Extract<TeachEvent, { kind: "draw" }>; eventIndex: number }> = [];
  let speechAtMs = 0;

  for (let eventIndex = from; eventIndex < to; eventIndex++) {
    const event = events[eventIndex]!;
    if (event.kind === "speak") {
      const estimatedDurationMs = estimateSpeechDurationMs(event.text);
      speech.push({ event, eventIndex, atMs: speechAtMs, estimatedDurationMs });
      speechAtMs += estimatedDurationMs;
    } else {
      drawEvents.push({ event, eventIndex });
    }
  }

  if (!drawEvents.length) {
    return { from, to, estimatedDurationMs: speechAtMs, speech, draws: [] };
  }

  if (!speech.length) {
    const draws = drawEvents.map((draw, index) => ({
      ...draw,
      atMs: index * DRAW_ONLY_CADENCE_MS,
    }));
    return {
      from,
      to,
      estimatedDurationMs: Math.max(MIN_SPEECH_MS, draws.at(-1)!.atMs + DRAW_ONLY_CADENCE_MS),
      speech,
      draws,
    };
  }

  // Spread visuals through the narration rather than starting every drawing
  // at once. The pen starts almost immediately with the voice — a teacher
  // talks WHILE drawing, not before it — with a short tail for the last
  // stroke before the next beat.
  const cueWindowStart = Math.min(120, speechAtMs * 0.08);
  const cueWindowEnd = Math.max(cueWindowStart, speechAtMs - 360);
  const cueWindowMs = cueWindowEnd - cueWindowStart;
  // When a model emits many tiny board actions, batch them into a bounded
  // number of cue moments. React then mounts each batch together and Board
  // focuses only its last item, avoiding a stack of interrupted camera tweens.
  const cueMoments = Math.min(
    drawEvents.length,
    Math.max(1, Math.floor(cueWindowMs / MIN_CAMERA_CUE_GAP_MS) + 1),
  );
  const draws = drawEvents.map((draw, index) => ({
    ...draw,
    atMs: (() => {
      if (cueMoments === 1) return cueWindowStart;
      const moment = Math.round((index * (cueMoments - 1)) / (drawEvents.length - 1));
      return cueWindowStart + (cueWindowMs * moment) / (cueMoments - 1);
    })(),
  }));

  return { from, to, estimatedDurationMs: speechAtMs, speech, draws };
}

/**
 * Turn the document-order event stream into narration/visual beats.
 * A beat contains a run of speech and the immediately following run of board
 * actions. Starting from an interruption cursor produces the same suffix.
 */
export function buildLessonTimeline(events: TeachEvent[], startAt = 0): LessonBeat[] {
  const beats: LessonBeat[] = [];
  let cursor = Math.max(0, Math.min(events.length, startAt));

  while (cursor < events.length) {
    const from = cursor;
    while (cursor < events.length && events[cursor]!.kind === "speak") cursor++;
    while (cursor < events.length && events[cursor]!.kind === "draw") cursor++;
    // TeachEvent currently has only these two kinds; retain a progress guard
    // so a future protocol extension cannot wedge the performer.
    if (cursor === from) cursor++;
    beats.push(planBeat(events, from, cursor));
  }

  return beats;
}
