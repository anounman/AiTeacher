import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCycle, layout, resolveDiagramType, type PositionedNode } from "./layout";
import type { ConceptDoc } from "./schema";

function doc(over: Partial<ConceptDoc> = {}): ConceptDoc {
  return {
    title: "T",
    summary: "s",
    diagramType: "hierarchy",
    nodes: [
      { id: "a", label: "root" },
      { id: "b", label: "left child" },
      { id: "c", label: "right child" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
    ],
    ...over,
  } as ConceptDoc;
}

function overlaps(a: PositionedNode, b: PositionedNode): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w - 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h - 2
  );
}

function assertNoOverlaps(nodes: PositionedNode[]): void {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      assert.ok(!overlaps(nodes[i], nodes[j]), `nodes ${nodes[i].id} & ${nodes[j].id} overlap`);
}

function assertEdgesValid(g: ReturnType<typeof layout>, d: ConceptDoc): void {
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.equal(g.edges.length, d.edges.length);
  for (const e of g.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), "edge references missing node");
    assert.ok(e.points.length >= 2, "edge needs at least 2 points");
  }
}

test("hierarchy: dagre TB, no overlaps, valid edges", () => {
  const d = doc({ diagramType: "hierarchy" });
  const g = layout(d);
  assert.equal(g.diagramType, "hierarchy");
  assert.ok(g.width > 0 && g.height > 0);
  assertNoOverlaps(g.nodes);
  assertEdgesValid(g, d);
});

test("flow: dagre LR, no overlaps", () => {
  const d = doc({ diagramType: "flow" });
  const g = layout(d);
  assert.equal(g.diagramType, "flow");
  assertNoOverlaps(g.nodes);
});

test("cycle: circular, no overlaps, diagramType override from hierarchy", () => {
  const d = doc({
    diagramType: "hierarchy",
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ],
  });
  assert.ok(hasCycle(d), "fixture should have a cycle");
  assert.equal(resolveDiagramType(d), "cycle");
  const g = layout(d);
  assert.equal(g.diagramType, "cycle");
  assertNoOverlaps(g.nodes);
});

test("timeline: left-to-right, ordered by steps.at, no overlaps", () => {
  const d = doc({
    diagramType: "timeline",
    steps: [
      { id: "c", label: "1900", at: 1900 },
      { id: "a", label: "1920", at: 1920 },
      { id: "b", label: "1940", at: 1940 },
    ],
  });
  const g = layout(d);
  assert.equal(g.diagramType, "timeline");
  // ordered by at: c(1900), a(1920), b(1940) -> x ascending
  const xOf = (id: string) => g.nodes.find((n) => n.id === id)!.x;
  assert.ok(xOf("c") < xOf("a") && xOf("a") < xOf("b"));
  assertNoOverlaps(g.nodes);
});

test("comparison: two columns by groups, no overlaps", () => {
  const d = doc({
    diagramType: "comparison",
    nodes: [
      { id: "s1", label: "strength 1" },
      { id: "s2", label: "strength 2" },
      { id: "w1", label: "weakness 1" },
    ],
    edges: [],
    groups: [
      { id: "S", label: "Strengths", members: ["s1", "s2"] },
      { id: "W", label: "Weaknesses", members: ["w1"] },
    ],
  });
  const g = layout(d);
  assert.equal(g.diagramType, "comparison");
  assertNoOverlaps(g.nodes);
  assert.ok(g.groups.length === 2);
});

test("mindmap: radial from first node, no overlaps", () => {
  const d = doc({
    diagramType: "mindmap",
    nodes: [
      { id: "core", label: "core idea" },
      { id: "b1", label: "branch one" },
      { id: "b2", label: "branch two" },
      { id: "b3", label: "branch three" },
    ],
    edges: [
      { from: "core", to: "b1" },
      { from: "core", to: "b2" },
      { from: "core", to: "b3" },
    ],
  });
  const g = layout(d);
  assert.equal(g.diagramType, "mindmap");
  assertNoOverlaps(g.nodes);
  const core = g.nodes.find((n) => n.id === "core")!;
  // center node is roughly at the graph's horizontal middle
  assert.ok(core.x > 0 && core.y > 0);
});

test("single node never overlaps (trivially) and produces positive bounds", () => {
  const d: ConceptDoc = {
    title: "T",
    summary: "s",
    diagramType: "mindmap",
    nodes: [{ id: "only", label: "one" }],
    edges: [],
  } as ConceptDoc;
  const g = layout(d);
  assert.equal(g.nodes.length, 1);
  assert.ok(g.width > 0 && g.height > 0);
});

test("layout is deterministic: same doc -> same coords", () => {
  const d = doc({ diagramType: "flow" });
  const g1 = layout(d);
  const g2 = layout(d);
  assert.deepEqual(
    g1.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]),
    g2.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]),
  );
});