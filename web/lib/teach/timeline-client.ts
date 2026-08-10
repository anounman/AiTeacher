import type { TeachEvent } from "./protocol";
import { buildLessonTimeline, type LessonBeat } from "./timeline";

// The cue plan is decided by the teacher service (teacher/app/performance),
// next to the agents that produce the lesson. This asks for it and rehydrates
// the returned indices back into real events, so the performer's code is
// unchanged.
//
// Only `kind` goes over the wire — the plan is a function of the event shape,
// not of the markup — which keeps a long lesson's request small.
//
// If the service is unreachable the browser plans locally. The two planners
// are held byte-identical by teacher/tests/test_timeline_parity.py, so the
// fallback is the same lesson, not a degraded one.

interface WireBeat {
  from: number;
  to: number;
  estimatedDurationMs: number;
  speech: { eventIndex: number; atMs: number; estimatedDurationMs: number }[];
  draws: { eventIndex: number; atMs: number }[];
}

function rehydrate(beats: WireBeat[], events: TeachEvent[]): LessonBeat[] {
  return beats.map((beat) => ({
    from: beat.from,
    to: beat.to,
    estimatedDurationMs: beat.estimatedDurationMs,
    speech: beat.speech.flatMap((cue) => {
      const event = events[cue.eventIndex];
      if (event?.kind !== "speak") return [];
      return [{ event, eventIndex: cue.eventIndex, atMs: cue.atMs, estimatedDurationMs: cue.estimatedDurationMs }];
    }),
    draws: beat.draws.flatMap((cue) => {
      const event = events[cue.eventIndex];
      if (event?.kind !== "draw") return [];
      return [{ event, eventIndex: cue.eventIndex, atMs: cue.atMs }];
    }),
  }));
}

export async function planLessonTimeline(
  events: TeachEvent[],
  startAt = 0,
): Promise<LessonBeat[]> {
  try {
    const res = await fetch("/api/teach/timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: events.map((event) => ({ kind: event.kind })),
        startAt,
      }),
      // A lesson must not wait on planning. The local planner is right here.
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) throw new Error(`timeline ${res.status}`);
    const data = (await res.json()) as { beats?: WireBeat[] };
    if (!data.beats) throw new Error("no beats");
    return rehydrate(data.beats, events);
  } catch {
    return buildLessonTimeline(events, startAt);
  }
}
