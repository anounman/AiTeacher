import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Set up a DOM before importing rough.js-backed render. rough.js only touches the DOM when
// drawing, not at import, but we set globals first to be safe.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: "http://localhost/",
});
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;

const { drawConcept } = await import("./render.js");
const { layout } = await import("./layout.js");
import type { ConceptDoc } from "./schema";

function makeSvg(): SVGSVGElement {
  return dom.window.document.createElementNS("http://www.w3.org/2000/svg", "svg") as unknown as SVGSVGElement;
}

const d: ConceptDoc = {
  title: "Half Adder",
  summary: "Sum and carry from two bits.",
  diagramType: "flow",
  nodes: [
    { id: "a", label: "input A" },
    { id: "b", label: "input B" },
    { id: "sum", label: "XOR -> sum" },
    { id: "carry", label: "AND -> carry" },
  ],
  edges: [
    { from: "a", to: "sum", label: "A" },
    { from: "b", to: "sum", label: "B" },
    { from: "a", to: "carry" },
    { from: "b", to: "carry" },
  ],
} as ConceptDoc;

test("drawConcept produces an SVG with a viewBox and children", () => {
  const g = layout(d);
  const svg = makeSvg();
  drawConcept(svg, g);
  assert.ok(svg.getAttribute("viewBox"), "viewBox should be set");
  // background + at least one shape per node + edge + labels
  assert.ok(svg.childNodes.length >= g.nodes.length + g.edges.length, "should have many children");
});

test("one rough shape group per node (path/rect/ellipse appended)", () => {
  const g = layout(d);
  const svg = makeSvg();
  drawConcept(svg, g);
  // rough.js appends <g> elements for shapes; labels are <text>; backing is <rect>.
  const groups = svg.querySelectorAll("g").length;
  assert.ok(groups >= g.nodes.length + g.edges.length, `expected >= ${g.nodes.length + g.edges.length} groups, got ${groups}`);
});

test("drawConcept is idempotent (re-draw wipes and redraws)", () => {
  const g = layout(d);
  const svg = makeSvg();
  drawConcept(svg, g);
  const first = svg.childNodes.length;
  drawConcept(svg, g);
  const second = svg.childNodes.length;
  assert.equal(first, second, "re-draw should produce the same child count");
});

test("seeds make render deterministic (same graph -> identical outerHTML)", () => {
  const g = layout(d);
  const a = makeSvg();
  const b = makeSvg();
  drawConcept(a, g);
  drawConcept(b, g);
  assert.equal(a.outerHTML, b.outerHTML);
});

test("empty-edge single node still renders", () => {
  const single: ConceptDoc = {
    title: "T",
    summary: "s",
    diagramType: "mindmap",
    nodes: [{ id: "n", label: "only" }],
    edges: [],
  } as ConceptDoc;
  const svg = makeSvg();
  drawConcept(svg, layout(single));
  assert.ok(svg.childNodes.length > 1);
});