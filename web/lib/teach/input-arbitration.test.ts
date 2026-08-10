import test from "node:test";
import assert from "node:assert/strict";
import { shouldBlockTouchNavigation } from "./input-arbitration";

test("Apple Pencil never reaches the canvas pan engine", () => {
  assert.equal(
    shouldBlockTouchNavigation({
      penMode: false,
      pencilPointerActive: false,
      activeInkStroke: false,
      navigationGestureActive: false,
      touchCount: 1,
      touchTypes: ["stylus"],
    }),
    true,
  );
});

test("pointer detection protects Pencil when Safari omits touchType", () => {
  assert.equal(
    shouldBlockTouchNavigation({
      penMode: false,
      pencilPointerActive: true,
      activeInkStroke: true,
      navigationGestureActive: false,
      touchCount: 1,
      touchTypes: ["direct"],
    }),
    true,
  );
});

test("one finger writes in Pen mode but navigates outside it", () => {
  const base = {
    pencilPointerActive: false,
    activeInkStroke: false,
    navigationGestureActive: false,
    touchCount: 1,
    touchTypes: ["direct"],
  };
  assert.equal(shouldBlockTouchNavigation({ ...base, penMode: true }), true);
  assert.equal(shouldBlockTouchNavigation({ ...base, penMode: false }), false);
});

test("two fingers retain notebook pan and pinch navigation", () => {
  assert.equal(
    shouldBlockTouchNavigation({
      penMode: true,
      pencilPointerActive: false,
      activeInkStroke: true,
      navigationGestureActive: false,
      touchCount: 2,
      touchTypes: ["direct", "direct"],
    }),
    false,
  );
});

test("two-finger navigation receives its final one-touch end event", () => {
  assert.equal(
    shouldBlockTouchNavigation({
      penMode: true,
      pencilPointerActive: false,
      activeInkStroke: false,
      navigationGestureActive: true,
      touchCount: 1,
      touchTypes: ["direct"],
    }),
    false,
  );
});
