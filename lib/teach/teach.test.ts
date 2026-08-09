import { test } from "node:test";
import assert from "node:assert/strict";
import { BVH, intersects } from "./bvh";
import { parseTeachEvents, parseBoardFence, speakable, toTranscriptParts } from "./protocol";

test("BVH queryRect finds exactly the intersecting leaves", () => {
  const leaves = [];
  for (let i = 0; i < 100; i++) {
    leaves.push({ box: { x: (i % 10) * 20, y: Math.floor(i / 10) * 20, w: 10, h: 10 }, data: i });
  }
  const bvh = new BVH(leaves);
  const rect = { x: 15, y: 15, w: 30, h: 30 };
  const got = new Set(bvh.queryRect(rect));
  const want = new Set(
    leaves.filter((l) => intersects(l.box, rect)).map((l) => l.data),
  );
  assert.deepEqual(got, want);
  assert.ok(want.size > 0);
});

test("BVH point query", () => {
  const bvh = new BVH([
    { box: { x: 0, y: 0, w: 50, h: 50 }, data: "a" },
    { box: { x: 100, y: 100, w: 50, h: 50 }, data: "b" },
  ]);
  assert.deepEqual(bvh.queryPoint(25, 25), ["a"]);
  assert.deepEqual(bvh.queryPoint(125, 125), ["b"]);
  assert.deepEqual(bvh.queryPoint(75, 75), []);
});

test("parseTeachEvents: stable prefix while streaming", () => {
  const full = `Hello there. This is calculus.\n\n\`\`\`board\n[{"type":"heading","text":"Derivatives"}]\n\`\`\`\n\nNow the definition. Watch closely.`;
  let prev: ReturnType<typeof parseTeachEvents> = [];
  for (let cut = 0; cut <= full.length; cut += 7) {
    const events = parseTeachEvents(full.slice(0, cut), false);
    // every previously emitted event must be identical at the same index
    for (let i = 0; i < prev.length; i++) {
      assert.deepEqual(events[i], prev[i], `event ${i} changed at cut ${cut}`);
    }
    prev = events;
  }
  const done = parseTeachEvents(full, true);
  assert.equal(done.filter((e) => e.kind === "draw").length, 1);
  assert.equal(done.filter((e) => e.kind === "speak").length, 4);
});

test("parseBoardFence: drops invalid entries, keeps valid, mark defaults", () => {
  const actions = parseBoardFence(
    `[{"type":"latex","tex":"x^2","id":"eq1"},{"type":"bogus"},{"type":"mark","target":"eq1#p"}]`,
  );
  assert.equal(actions.length, 2);
  const mark = actions[1]!;
  assert.equal(mark.type, "mark");
  if (mark.type === "mark") {
    assert.equal(mark.style, "circle");
    assert.equal(mark.color, "red");
  }
});

test("speakable strips math, markers, markdown", () => {
  assert.equal(
    speakable("The **discriminant** $b^2-4ac$ [S:c12] decides it."),
    "The discriminant decides it.",
  );
});

test("toTranscriptParts preserves the shared event cursor ranges", () => {
  const events = parseTeachEvents(
    `First sentence.\n\n\`\`\`board\n[{"type":"write","markup":"one"},{"type":"write","markup":"two"}]\n\`\`\`\n\nSecond sentence.`,
    true,
  );
  assert.deepEqual(toTranscriptParts(events), [
    { kind: "speak", text: "First sentence.", from: 0, to: 1 },
    { kind: "steps", n: 2, from: 1, to: 3 },
    { kind: "speak", text: "Second sentence.", from: 3, to: 4 },
  ]);
});
