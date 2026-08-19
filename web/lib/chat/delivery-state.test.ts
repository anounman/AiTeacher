import assert from "node:assert/strict";
import test from "node:test";

import { interruptedReplyLabel, type DeliveryState } from "./delivery-state";

test("DeliveryState supports complete and interrupted replies", () => {
  const states: DeliveryState[] = ["complete", "interrupted"];

  assert.deepEqual(states, ["complete", "interrupted"]);
});

test("interruptedReplyLabel explains how to recover a partial reply", () => {
  assert.equal(
    interruptedReplyLabel("The derivation starts by isolating x."),
    "Response interrupted — retry to continue.",
  );
});

test("interruptedReplyLabel hides the label when no partial reply exists", () => {
  assert.equal(interruptedReplyLabel(""), null);
  assert.equal(interruptedReplyLabel("   \n\t "), null);
});
