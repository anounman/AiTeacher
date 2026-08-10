import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLayout, type LayoutProblem } from "./visual-engine-guard";
import type { PositionedGraph } from "@/lib/visual-engine/index";

function graph(partial: Partial<PositionedGraph>): PositionedGraph {
  return {
    diagramType: "flow",
    width: 400,
    height: 300,
    nodes: [],
    edges: [],
    groups: [],
    ...partial,
  } as PositionedGraph;
}

const node = (id: string, x: number, y: number, w = 100, h = 60) =>
  ({ id, label: id, kind: "box", x, y, w, h }) as PositionedGraph["nodes"][number];

const kinds = (problems: LayoutProblem[]) => problems.map((p) => p.kind);

test("a clean layout reports nothing", () => {
  const result = checkLayout(graph({ nodes: [node("a", 60, 50), node("b", 240, 50)] }));
  assert.deepEqual(result, []);
});

test("overlapping nodes are caught", () => {
  const result = checkLayout(graph({ nodes: [node("a", 100, 100), node("b", 130, 100)] }));
  assert.ok(kinds(result).includes("overlap"));
});

test("touching edges are not an overlap", () => {
  // Sketched outlines wander a few px; boxes that merely abut read fine.
  const result = checkLayout(graph({ nodes: [node("a", 100, 100), node("b", 200, 100)] }));
  assert.deepEqual(result, []);
});

test("a node past the canvas edge is caught", () => {
  const result = checkLayout(graph({ nodes: [node("a", 380, 50)] }));
  assert.ok(kinds(result).includes("out-of-bounds"));
});

test("an edge to a node that does not exist is caught", () => {
  const result = checkLayout(
    graph({
      nodes: [node("a", 60, 50)],
      edges: [{ from: "a", to: "ghost", kind: "solid", points: [] }] as PositionedGraph["edges"],
    }),
  );
  assert.ok(kinds(result).includes("dangling-edge"));
});

test("an empty layout is a problem, not a pass", () => {
  // The failure this exists to prevent: a diagram that renders as blank paper
  // and reports success because nothing overlapped.
  assert.deepEqual(kinds(checkLayout(graph({ nodes: [] }))), ["empty"]);
});

test("a zero-size canvas is degenerate", () => {
  const result = checkLayout(graph({ width: 0, height: 0, nodes: [node("a", 0, 0)] }));
  assert.ok(kinds(result).includes("degenerate"));
});
