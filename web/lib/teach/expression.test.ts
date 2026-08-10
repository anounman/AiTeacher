import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPRESSION_PROFILES,
  inferSpeechExpression,
  isTeachingExpression,
} from "./expression";

test("inferSpeechExpression uses deterministic teaching-oriented precedence", () => {
  // Precedence is the contract; the rate/pace each expression carries is
  // tuning that lives in EXPRESSION_PROFILES.
  const cases: [string, string][] = [
    ["Don't worry—this can feel difficult!", "reassuring"],
    ["Excellent, that is exactly right!", "encouraging"],
    ["Why does the derivative vanish?", "curious"],
    ["This is the key point.", "serious"],
    ["Now watch!", "excited"],
  ];
  for (const [text, expression] of cases) {
    const cue = inferSpeechExpression(text);
    assert.equal(cue.expression, expression, text);
    assert.deepEqual(cue, {
      expression,
      pace: EXPRESSION_PROFILES[cue.expression].pace,
      rate: EXPRESSION_PROFILES[cue.expression].rate,
    });
  }
});

test("all expression profiles stay in a natural, bounded range", () => {
  for (const [name, profile] of Object.entries(EXPRESSION_PROFILES)) {
    assert.equal(profile.expression, name);
    assert.ok(profile.rate >= 0.7 && profile.rate <= 1.3, `${name} rate`);
    assert.ok(profile.volume >= 0.85 && profile.volume <= 1.2, `${name} volume`);
    assert.equal(isTeachingExpression(name), true);
  }
  assert.equal(isTeachingExpression("angry"), false);
  assert.equal(isTeachingExpression(1), false);
});

test("expression rates are far enough apart to actually hear", () => {
  // Kokoro has no emotion control, so speed IS the delivery. A spread below
  // roughly 10% is under the just-noticeable difference and every expression
  // ends up sounding identical — the bug this range replaced.
  const rates = Object.values(EXPRESSION_PROFILES).map((p) => p.rate);
  assert.ok(Math.max(...rates) - Math.min(...rates) >= 0.3, "rate spread too narrow to perceive");
});

