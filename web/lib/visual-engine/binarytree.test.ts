import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// DOM globals so importing render.js (pulled in by the cs pack -> tree primitive) is safe, and
// so the render smoke test below can draw into a real <svg>.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: "http://localhost/" });
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;

// Side-effect: register cs.prog1 templates + treeNode/branchEdge primitives.
await import("./packs/cs.js");
const { layout } = await import("./layout.js");
const { drawConcept } = await import("./render.js");
import type { ConceptDoc } from "./schema";

/** The 7-node full binary tree from the cs.prog1.binaryTree few-shot. */
const treeDoc: ConceptDoc = {
  title: "Binary Tree",
  summary: "A binary tree branches: each node has at most two children, labeled left and right.",
  diagramType: "hierarchy",
  template: "cs.prog1.binaryTree",
  subject: "cs",
  course: "cs.prog1",
  domain: { root: "root" },
  nodes: [
    { id: "root", label: "root", kind: "box" },
    { id: "L", label: "left child", kind: "box" },
    { id: "R", label: "right child", kind: "box" },
    { id: "LL", label: "left-left", kind: "box" },
    { id: "LR", label: "left-right", kind: "box" },
    { id: "RL", label: "right-left", kind: "box" },
    { id: "RR", label: "right-right", kind: "box" },
  ],
  edges: [
    { from: "root", to: "L", label: "left" },
    { from: "root", to: "R", label: "right" },
    { from: "L", to: "LL", label: "left" },
    { from: "L", to: "LR", label: "right" },
    { from: "R", to: "RL", label: "left" },
    { from: "R", to: "RR", label: "right" },
  ],
} as ConceptDoc;

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w - 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h - 2;
}

test("binary tree: layout dispatches through the cs.prog1.binaryTree template", () => {
  const g = layout(treeDoc);
  // treeNode/branchEdge primitives are set by layoutBinaryTree.
  assert.equal(g.nodes.every((n) => n.primitive === "treeNode"), true);
  assert.equal(g.edges.every((e) => e.primitive === "branchEdge"), true);
});

test("binary tree: >=3 distinct y-levels (it actually branches)", () => {
  const g = layout(treeDoc);
  const ys = new Set(g.nodes.map((n) => Math.round(n.y)));
  assert.ok(ys.size >= 3, `expected >=3 distinct y-levels, got ${ys.size}`);
});

test("binary tree: root has exactly 2 children on opposite sides", () => {
  const g = layout(treeDoc);
  const x = (id: string) => g.nodes.find((n) => n.id === id)!.x;
  const root = x("root");
  const left = x("L");
  const right = x("R");
  assert.ok(left < root, `left child (${left}) must be left of root (${root})`);
  assert.ok(right > root, `right child (${right}) must be right of root (${root})`);
});

test("binary tree: no node has more than 2 children", () => {
  const counts = new Map<string, number>();
  for (const e of treeDoc.edges) counts.set(e.from, (counts.get(e.from) ?? 0) + 1);
  for (const [id, c] of counts) assert.ok(c <= 2, `node ${id} has ${c} children`);
});

test("binary tree: no node overlaps another", () => {
  const g = layout(treeDoc);
  for (let i = 0; i < g.nodes.length; i++)
    for (let j = i + 1; j < g.nodes.length; j++)
      assert.ok(!overlaps(g.nodes[i], g.nodes[j]), `nodes ${g.nodes[i].id} & ${g.nodes[j].id} overlap`);
});

test("binary tree: child edges carry left/right labels", () => {
  const g = layout(treeDoc);
  const rootEdges = g.edges.filter((e) => e.from === "root");
  assert.equal(rootEdges.length, 2);
  const labels = rootEdges.map((e) => e.label).sort();
  assert.deepEqual(labels, ["left", "right"]);
});

test("binary tree: renders into an SVG without throwing", () => {
  const g = layout(treeDoc);
  const svg = dom.window.document.createElementNS("http://www.w3.org/2000/svg", "svg") as unknown as SVGSVGElement;
  drawConcept(svg, g);
  assert.ok(svg.getAttribute("viewBox"), "viewBox set");
  assert.ok(svg.childNodes.length > g.nodes.length, "drew shapes + labels");
});

test("binary tree: layout is deterministic (same doc -> same coords)", () => {
  const a = layout(treeDoc);
  const b = layout(treeDoc);
  assert.deepEqual(
    a.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]),
    b.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]),
  );
});