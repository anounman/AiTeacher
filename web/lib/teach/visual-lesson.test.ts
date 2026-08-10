import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTeachEvents } from "./protocol";
import { appendVisualPlan, segmentEventIndex, visualInputFromLesson } from "./visual-lesson";
import { fallbackVisualPlan } from "./visual-director";

const lesson = `A request enters the application.\n\n\`\`\`board
[
  {"type":"write","id":"client","markup":"Client"},
  {"type":"write","id":"api","markup":"API"},
  {"type":"write","id":"database","markup":"Database"}
]
\`\`\``;

test("visual input uses transcript IDs and the player's board order", () => {
  const input = visualInputFromLesson(lesson, "lesson-1");
  assert.equal(input.segments[0]?.id, "segment-1");
  assert.deepEqual(input.segments[0]?.boardElementIds, ["client", "api", "database"]);
  assert.deepEqual(input.relationships.map(({ from, to }) => [from, to]), [
    ["client", "api"],
    ["api", "database"],
  ]);
});

test("appending a visual scene preserves every spoken byte and stays idempotent", () => {
  const input = visualInputFromLesson(lesson, "lesson-1");
  const plan = fallbackVisualPlan(input);
  const directed = appendVisualPlan(lesson, plan);
  const beforeSpeech = parseTeachEvents(lesson, true).filter((event) => event.kind === "speak");
  const afterSpeech = parseTeachEvents(directed, true).filter((event) => event.kind === "speak");
  assert.deepEqual(afterSpeech, beforeSpeech);
  assert.equal(appendVisualPlan(directed, plan), directed);
  assert.ok(parseTeachEvents(directed, true).some((event) => event.kind === "draw" && event.action.type === "visual_scene"));
});

test("segment cue IDs resolve to the same event cursor used by transcript and voice", () => {
  const events = parseTeachEvents(lesson, true);
  assert.equal(segmentEventIndex(events, "segment-1"), 0);
  assert.equal(segmentEventIndex(events, "segment-9"), null);
});
