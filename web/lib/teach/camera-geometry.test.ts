import test from "node:test";
import assert from "node:assert/strict";
import {
  constrainViewport,
  fitPageWidth,
  focusViewportOnRect,
  usableCameraFrame,
  zoomViewportAt,
} from "./camera-geometry";

// The sheet is infinite: programmatic moves get generous slack (±75% of the
// viewport) around the content instead of hard page edges. A camera thrown
// absurdly far still comes back to within slack of the writing.
test("a runaway programmatic move is pulled back to within slack of the content", () => {
  const screen = { w: 820, h: 1180 };
  const content = { w: 980, h: 2400 };
  const bounded = constrainViewport({ x: 9_000, y: -20_000, k: 1 }, screen, content);
  assert.equal(bounded.k, 1);
  // x slack: max = 0 + 0.75*820; y slack: min = (1180-2400) - 0.75*1180.
  assert.equal(bounded.x, screen.w * 0.75);
  assert.equal(bounded.y, screen.h - content.h - screen.h * 0.75);
});

test("small drifts near the content are left alone (infinite-sheet feel)", () => {
  const bounded = constrainViewport(
    { x: -400, y: 700, k: 0.5 },
    { w: 820, h: 1180 },
    { w: 980, h: 1200 },
  );
  // Within slack of the centered position — no snap-back.
  assert.deepEqual(bounded, { x: -400, y: 700, k: 0.5 });
});

test("pinch zoom keeps its focal point stable when bounds allow it", () => {
  const next = zoomViewportAt(
    { x: -100, y: -200, k: 1 },
    1.5,
    { x: 300, y: 400 },
    { w: 820, h: 1180 },
    { w: 1600, h: 2600 },
  );
  assert.equal(next.k, 1.5);
  assert.equal((300 - next.x) / next.k, (300 - -100) / 1);
  assert.equal((400 - next.y) / next.k, (400 - -200) / 1);
});

test("fit uses page width at a readable scale", () => {
  const fit = fitPageWidth({ w: 820, h: 1180 }, { w: 980, h: 2200 });
  assert.equal(Math.round(fit.k * 100), 77);
  assert.equal(Math.round(fit.x), 32);
  assert.equal(fit.y, 0);
});

test("agent focus stays in the unobscured iPad frame and never changes zoom", () => {
  const screen = { w: 820, h: 1180 };
  const insets = { top: 150, right: 340, bottom: 130, left: 24 };
  const target = { x: 460, y: 1500, w: 220, h: 90 };
  const next = focusViewportOnRect({
    current: { x: 0, y: 0, k: 0.8 },
    target,
    screen,
    content: { w: 980, h: 2600 },
    insets,
  });
  const frame = usableCameraFrame(screen, insets);
  const screenCenter = next.x + (target.x + target.w / 2) * next.k;
  const screenTop = next.y + target.y * next.k;
  assert.equal(next.k, 0.8);
  assert.ok(screenCenter >= frame.x && screenCenter <= frame.x + frame.w);
  assert.ok(screenTop >= frame.y && screenTop <= frame.y + frame.h);
});
