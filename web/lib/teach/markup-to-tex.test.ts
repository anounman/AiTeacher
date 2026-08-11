import { test } from "node:test";
import assert from "node:assert/strict";
import { markupToTex, isProse } from "./markup-to-tex";

test("the quadratic formula converts faithfully", () => {
  const result = markupToTex("x = [F]-b ± [R]b² - 4ac[/R]|2a[/F]");
  assert.ok(result);
  assert.equal(result.heading, false);
  assert.equal(result.tex, "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}");
});

test("headings are recognised and stripped", () => {
  const result = markupToTex("~~The Quadratic Formula~~");
  assert.deepEqual(result, { tex: "The Quadratic Formula", heading: true });
});

test("sums integrals boxes and scripts convert", () => {
  assert.equal(markupToTex("[S]k=0|n[/S] k²")!.tex, "\\sum_{k=0}^{n} k^{2}");
  assert.equal(markupToTex("[I]0|1[/I] x dx")!.tex, "\\int_{0}^{1} x dx");
  assert.equal(markupToTex("[B]d = 3[/B]")!.tex, "\\boxed{d = 3}");
  assert.equal(markupToTex("e[U]-t[/U]")!.tex, "e^{-t}");
  assert.equal(markupToTex("a₁ + a₂")!.tex, "a_{1} + a_{2}");
});

test("what cannot be expressed returns null instead of guessing", () => {
  // Tables, diagrams and strikethrough have no faithful MathTex form.
  assert.equal(markupToTex("[T]A|B\\n0|1[/T]"), null);
  assert.equal(markupToTex('[G]{"type":"tree"}[/G]'), null);
  assert.equal(markupToTex("[X]wrong[/X]"), null);
  // Unknown unicode must not be silently dropped.
  assert.equal(markupToTex("f(x) = ⚡"), null);
  // Multi-line items keep mathwriter's per-line bands.
  assert.equal(markupToTex("line one\nline two"), null);
});

test("unbalanced tags fall back rather than emitting broken TeX", () => {
  assert.equal(markupToTex("[F]a|b"), null);
  assert.equal(markupToTex("x [/R] y"), null);
});

test("prose detection separates sentences from formulas", () => {
  assert.ok(isProse("the slope of the tangent line at a point"));
  assert.ok(!isProse("x = 2a + b"));
  assert.ok(!isProse("f(x) dx"));
});
