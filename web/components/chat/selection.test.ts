import assert from "node:assert/strict";
import test from "node:test";
import { placeSelectionAction } from "./selection";

test("placeSelectionAction flips below and clamps at viewport edges", () => {
  assert.deepEqual(
    placeSelectionAction({ left: 2, top: 1, width: 50, height: 16 }, { width: 320, height: 200 }),
    { left: 8, top: 23, placement: "below" },
  );
});

test("placeSelectionAction stays above a lower selection", () => {
  assert.deepEqual(
    placeSelectionAction({ left: 140, top: 160, width: 50, height: 16 }, { width: 320, height: 200 }),
    { left: 140, top: 122, placement: "above" },
  );
});
