// Generates the cross-language parity fixture for the cue planner.
//
// The browser (lib/teach/timeline.ts) and the teacher service
// (teacher/app/performance/timeline.py) must produce identical cue plans, or a
// lesson would play differently depending on whether the service was reachable.
// This dumps the TypeScript implementation's output; the Python test asserts
// against it. Regenerate deliberately when the timing policy changes:
//
//   node --import tsx web/scripts/dump-timeline-fixtures.mts
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TeachEvent } from "@/lib/teach/protocol";
import { buildLessonTimeline } from "@/lib/teach/timeline";

const speak = (text: string) => ({ kind: "speak", text }) as TeachEvent;
const draw = (markup: string) =>
  ({ kind: "draw", action: { type: "write", markup, color: "ink" } }) as TeachEvent;

const cases: { name: string; events: TeachEvent[]; startAt?: number }[] = [
  { name: "empty", events: [] },
  { name: "speech only", events: [speak("One sentence.")] },
  { name: "single draw", events: [draw("a")] },
  {
    name: "grouped beats",
    events: [speak("First point."), speak("Here is why."), draw("a"), draw("b"), speak("Next point."), draw("c")],
  },
  {
    name: "three visuals in one narration",
    events: [
      speak("Let us carefully build this visual explanation in three clear parts."),
      draw("one"),
      draw("two"),
      draw("three"),
    ],
  },
  {
    name: "dense visuals batch",
    events: [
      speak("This explanation is deliberately long enough to create several well spaced visual cue moments."),
      ...Array.from({ length: 12 }, (_, i) => draw(String(i))),
    ],
  },
  { name: "draw only cadence", events: [draw("one"), draw("two"), draw("three")] },
  {
    name: "interruption cursor",
    events: [speak("Delivered."), draw("old"), speak("Resume here."), draw("new")],
    startAt: 2,
  },
  {
    name: "punctuation heavy",
    events: [speak("First, second; third: fourth — done."), draw("x"), draw("y")],
  },
  {
    name: "very long speech clamps",
    events: [speak("word ".repeat(1000)), ...Array.from({ length: 5 }, (_, i) => draw(`d${i}`))],
  },
];

const out = cases.map(({ name, events, startAt }) => ({
  name,
  events: events.map((e) => (e.kind === "speak" ? { kind: "speak", text: e.text } : { kind: "draw" })),
  startAt: startAt ?? 0,
  beats: buildLessonTimeline(events, startAt ?? 0).map((beat) => ({
    from: beat.from,
    to: beat.to,
    estimatedDurationMs: beat.estimatedDurationMs,
    speech: beat.speech.map((cue) => ({
      eventIndex: cue.eventIndex,
      atMs: cue.atMs,
      estimatedDurationMs: cue.estimatedDurationMs,
    })),
    draws: beat.draws.map((cue) => ({ eventIndex: cue.eventIndex, atMs: cue.atMs })),
  })),
}));

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "..", "teacher", "tests", "fixtures", "timeline_cases.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.length} cases -> ${target}`);
