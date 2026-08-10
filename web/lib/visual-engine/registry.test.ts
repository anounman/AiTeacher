import { test } from "node:test";
import assert from "node:assert/strict";
// Side-effect: register the generic + cs packs.
import "./packs/generic";
import "./packs/cs";
import { getTemplate, getTemplates } from "./registry";

test("generic pack registers the 6 diagram-type templates", () => {
  for (const id of ["generic.hierarchy", "generic.flow", "generic.cycle", "generic.timeline", "generic.comparison", "generic.mindmap"]) {
    assert.ok(getTemplate(id), `${id} should be registered`);
  }
});

test("cs.prog1 templates are registered and course-scoped", () => {
  const t = getTemplate("cs.prog1.binaryTree");
  assert.ok(t);
  assert.equal(t!.course, "cs.prog1");
  assert.equal(t!.subject, "cs");
  assert.equal(typeof t!.layout, "function");
});

test("getTemplates(course) returns course templates + generic fallback", () => {
  const ts = getTemplates("cs.prog1");
  // all 10 cs.prog1 templates + 6 generic
  const courseOnes = ts.filter((t) => t.course === "cs.prog1");
  const genericOnes = ts.filter((t) => t.subject === "generic");
  assert.ok(courseOnes.length >= 10, `expected >=10 course templates, got ${courseOnes.length}`);
  assert.equal(genericOnes.length, 6, "generic pack always present");
  // course templates come first
  assert.ok(ts.indexOf(getTemplate("cs.prog1.binaryTree")!) < ts.indexOf(getTemplate("generic.flow")!));
});

test("getTemplates with no route returns generic only", () => {
  const ts = getTemplates();
  assert.ok(ts.every((t) => t.subject === "generic"));
  assert.equal(ts.length, 6);
});

test("unknown template id resolves to undefined", () => {
  assert.equal(getTemplate("no.such.template"), undefined);
  assert.equal(getTemplate(undefined), undefined);
});