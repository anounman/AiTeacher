import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coerceToDoc,
  fallbackDoc,
  validate,
  type ConceptDoc,
} from "./schema";

const goodDoc = {
  title: "Binary Search",
  summary: "Halve the range until found.",
  diagramType: "flow",
  nodes: [
    { id: "a", label: "start" },
    { id: "b", label: "check mid" },
  ],
  edges: [{ from: "a", to: "b" }],
};

test("valid ConceptDoc passes", () => {
  const v = validate(goodDoc);
  assert.ok(v.ok, JSON.stringify(!v.ok ? v.errors : []));
});

test("edge to unknown node is rejected", () => {
  const v = validate({ ...goodDoc, edges: [{ from: "a", to: "zzz" }] });
  assert.ok(!v.ok);
  assert.match(v.errors.join("; "), /unknown node "zzz"/);
});

test("empty nodes rejected", () => {
  const v = validate({ ...goodDoc, nodes: [], edges: [] });
  assert.ok(!v.ok);
});

test("multi-node no-edge non-mindmap rejected", () => {
  const v = validate({ ...goodDoc, diagramType: "hierarchy", edges: [] });
  assert.ok(!v.ok);
});

test("mindmap with no edges is allowed", () => {
  const v = validate({ ...goodDoc, diagramType: "mindmap", edges: [] });
  assert.ok(v.ok);
});

test("timeline without steps rejected", () => {
  const v = validate({ ...goodDoc, diagramType: "timeline", edges: [{ from: "a", to: "b" }] });
  assert.ok(!v.ok);
});

test("timeline with steps passes", () => {
  const v = validate({
    ...goodDoc,
    diagramType: "timeline",
    steps: [
      { id: "a", label: "first", at: 1900 },
      { id: "b", label: "second", at: 1920 },
    ],
  });
  assert.ok(v.ok);
});

test("coordinate fields are stripped (not part of schema)", () => {
  const v = validate({
    ...goodDoc,
    nodes: [
      { id: "a", label: "start", x: 10, y: 20 } as unknown as ConceptDoc["nodes"][number],
      { id: "b", label: "mid" },
    ],
  });
  assert.ok(v.ok);
  if (v.ok) assert.equal((v.doc.nodes[0] as unknown as { x?: number }).x, undefined);
});

test("coerceToDoc strips bad refs and relaxes to mindmap", () => {
  const coerced = coerceToDoc({
    title: "X",
    summary: "s",
    diagramType: "hierarchy",
    nodes: [{ id: "a", label: "one" }, { id: "b", label: "two" }],
    edges: [{ from: "a", to: "missing" }],
  });
  assert.ok(coerced);
  // bad edge dropped; multi-node no-edge -> relaxed to mindmap
  assert.equal(coerced!.diagramType, "mindmap");
  assert.equal(coerced!.edges.length, 0);
});

test("coerceToDoc returns null for non-object", () => {
  assert.equal(coerceToDoc("hello"), null);
  assert.equal(coerceToDoc(null), null);
});

test("fallbackDoc is always valid", () => {
  const d = fallbackDoc("photosynthesis");
  assert.equal(d.nodes.length, 1);
  assert.equal(d.diagramType, "mindmap");
  const v = validate(d);
  assert.ok(v.ok);
});