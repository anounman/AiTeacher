import { test } from "node:test";
import assert from "node:assert/strict";
import type { TeachEvent } from "./protocol";
import { buildLessonTimeline, estimateSpeechDurationMs } from "./timeline";

const speak = (text: string): TeachEvent => ({ kind: "speak", text });
const draw = (markup: string): TeachEvent => ({
  kind: "draw",
  action: { type: "write", markup, color: "ink" },
});

test("buildLessonTimeline groups narration with the board actions it introduces", () => {
  const timeline = buildLessonTimeline([
    speak("First point."),
    speak("Here is why."),
    draw("a"),
    draw("b"),
    speak("Next point."),
    draw("c"),
  ]);

  assert.deepEqual(
    timeline.map((beat) => ({ from: beat.from, to: beat.to, speech: beat.speech.length, draws: beat.draws.length })),
    [
      { from: 0, to: 4, speech: 2, draws: 2 },
      { from: 4, to: 6, speech: 1, draws: 1 },
    ],
  );
});

test("draw cues are monotonic and stay inside the narration window", () => {
  const [beat] = buildLessonTimeline([
    speak("Let us carefully build this visual explanation in three clear parts."),
    draw("one"),
    draw("two"),
    draw("three"),
  ]);
  assert.ok(beat);
  assert.ok(beat.draws[0]!.atMs > 0, "narration gets a lead-in");
  assert.ok(beat.draws[0]!.atMs < beat.draws[1]!.atMs);
  assert.ok(beat.draws[1]!.atMs < beat.draws[2]!.atMs);
  assert.ok(beat.draws[2]!.atMs < beat.estimatedDurationMs, "last visual starts before speech ends");
});

test("draws anchor to the sentence that introduces them, not the beat start", () => {
  const preamble = speak("First we recap what we already know from last time in some detail.");
  const intro = speak("Now let me write the integration by parts formula on the board.");
  const [beat] = buildLessonTimeline([preamble, intro, draw("∫u dv = uv - ∫v du")]);
  assert.ok(beat);
  const introCue = beat.speech.at(-1)!;
  assert.ok(introCue.atMs > 0, "intro sentence is not the first");
  assert.ok(
    beat.draws[0]!.atMs >= introCue.atMs,
    "pen waits for the introducing sentence instead of writing during the recap",
  );
  assert.ok(
    beat.draws[0]!.atMs < introCue.atMs + introCue.estimatedDurationMs,
    "pen starts while that sentence is being spoken",
  );
});

test("dense visuals batch into camera cues instead of interrupting every tween", () => {
  const events = [
    speak("This explanation is deliberately long enough to create several well spaced visual cue moments."),
    ...Array.from({ length: 12 }, (_, index) => draw(String(index))),
  ];
  const [beat] = buildLessonTimeline(events);
  assert.ok(beat);
  const moments = [...new Set(beat.draws.map((cue) => cue.atMs))];
  assert.ok(moments.length < beat.draws.length, "some actions share a camera cue");
  for (let index = 1; index < moments.length; index++) {
    assert.ok(moments[index]! - moments[index - 1]! >= 520);
  }
});

test("draw-only beats use a readable camera cadence", () => {
  const [beat] = buildLessonTimeline([draw("one"), draw("two"), draw("three")]);
  assert.ok(beat);
  assert.deepEqual(beat.draws.map((cue) => cue.atMs), [0, 650, 1300]);
});

test("an interruption cursor creates only the undelivered suffix", () => {
  const timeline = buildLessonTimeline(
    [speak("Delivered."), draw("old"), speak("Resume here."), draw("new")],
    2,
  );
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0]!.from, 2);
  assert.equal(timeline[0]!.speech[0]!.event.text, "Resume here.");
  assert.equal(timeline[0]!.draws[0]!.event.action.type, "write");
});

test("speech estimates scale with content and are bounded", () => {
  assert.ok(estimateSpeechDurationMs("A longer explanation has several more words in it.") > estimateSpeechDurationMs("Short."));
  assert.equal(estimateSpeechDurationMs("word ".repeat(1000)), 12_000);
});
