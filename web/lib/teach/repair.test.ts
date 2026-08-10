import { test } from "node:test";
import assert from "node:assert/strict";
import { planShifts, type Box } from "./repair";

const col: Box[] = [
  { x: 0, y: 0, w: 900, h: 100 },
  { x: 0, y: 120, w: 900, h: 200 },
  { x: 0, y: 340, w: 900, h: 80 },
];

test("an aside clear of everything does not move", () => {
  // True margin: left of the column.
  const shifts = planShifts(col, [{ x: -470, y: 50, w: 420, h: 90 }]);
  assert.deepEqual(shifts, [0]);
});

test("an aside overlapping column content slides below every blocker in its path", () => {
  const shifts = planShifts(col, [{ x: 200, y: 130, w: 420, h: 90 }]);
  // Below item 2 it still clips item 3, so it settles below item 3 + gap.
  assert.equal(shifts[0], 340 + 80 + 14 - 130);
});

test("stacked asides at the same anchor do not overlap each other", () => {
  const movables: Box[] = [
    { x: -470, y: 500, w: 420, h: 100 },
    { x: -470, y: 500, w: 420, h: 100 },
    { x: -470, y: 500, w: 420, h: 100 },
  ];
  const shifts = planShifts(col, movables);
  assert.deepEqual(shifts, [0, 114, 228]);
});

test("cascading blockers resolve in one pass and stay deterministic", () => {
  const obstacles: Box[] = [
    { x: 0, y: 0, w: 900, h: 100 },
    { x: 0, y: 114, w: 900, h: 100 }, // exactly where the first shift lands
  ];
  const a = planShifts(obstacles, [{ x: 100, y: 50, w: 200, h: 40 }]);
  const b = planShifts(obstacles, [{ x: 100, y: 50, w: 200, h: 40 }]);
  assert.deepEqual(a, b);
  // Ends below BOTH obstacles.
  assert.equal(a[0]! + 50 >= 214 + 14, true);
});

test("horizontally disjoint boxes never trigger a shift", () => {
  const shifts = planShifts(col, [{ x: 1000, y: 10, w: 300, h: 300 }]);
  assert.deepEqual(shifts, [0]);
});
