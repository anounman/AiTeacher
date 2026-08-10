/**
 * Stage 3 — Render: a PositionedGraph -> hand-drawn SVG via rough.js.
 *
 * Deterministic: every rough.js shape gets a seed derived from the element id, so the
 * hand-jitter is identical across re-renders (no flicker). Labels are real <text> in a
 * handwriting font (Caveat); shapes are rough.js sketched outlines + hachure fills. This is
 * the Excalidraw-style "best one" look, but driven entirely by deterministic layout — the
 * LLM never chose a single pixel.
 *
 * Framework-agnostic. In the browser the UI passes its <svg> ref; in tests, jsdom provides
 * one. drawConcept() clears the svg and appends children.
 */
import rough from "roughjs";
import type { Options } from "roughjs/bin/core.js";
import type { PositionedGraph, PositionedNode, PositionedPrimitive, RoutedEdge } from "./layout";

/** A rough.js canvas (the object rough.svg(svg) returns). */
export type RoughCanvas = ReturnType<typeof rough.svg>;

/**
 * Render primitive registries. A node/edge/canvas primitive is a hand-drawn glyph (tree node,
 * branch edge, stack frame, axes, …) registered by a `primitives/*.ts` module at import time.
 * drawConcept dispatches to the primitive when the positioned element carries a matching
 * `primitive` kind; otherwise it falls back to the default drawNode/drawEdge/drawGroup. With no
 * primitives registered (e.g. the original generic path), rendering is byte-identical to before.
 */
export type NodePrimitiveFn = (
  svg: SVGSVGElement,
  rc: RoughCanvas,
  n: PositionedNode,
  theme: RenderTheme,
) => void;
export type EdgePrimitiveFn = (
  svg: SVGSVGElement,
  rc: RoughCanvas,
  e: RoutedEdge,
  theme: RenderTheme,
) => void;
export type CanvasPrimitiveFn = (
  svg: SVGSVGElement,
  rc: RoughCanvas,
  p: PositionedPrimitive,
  theme: RenderTheme,
  graph: PositionedGraph,
) => void;

const NODE_PRIMITIVES = new Map<string, NodePrimitiveFn>();
const EDGE_PRIMITIVES = new Map<string, EdgePrimitiveFn>();
const CANVAS_PRIMITIVES = new Map<string, CanvasPrimitiveFn>();

export function registerNodePrimitive(kind: string, fn: NodePrimitiveFn): void {
  NODE_PRIMITIVES.set(kind, fn);
}
export function registerEdgePrimitive(kind: string, fn: EdgePrimitiveFn): void {
  EDGE_PRIMITIVES.set(kind, fn);
}
export function registerCanvasPrimitive(kind: string, fn: CanvasPrimitiveFn): void {
  CANVAS_PRIMITIVES.set(kind, fn);
}

export interface RenderTheme {
  paper: string; // svg background
  ink: string; // strokes + text
  inkSoft: string; // groups / secondary
  fill: string; // node hachure fill
  fillSolid: string; // emphasis node fill
  accent: string; // arrowheads / emphasis edges
  labelBg: string; // edge label backing
  font: string;
}

export const DEFAULT_THEME: RenderTheme = {
  paper: "#fbf7ee",
  ink: "#2f4858",
  inkSoft: "#8a93a6",
  fill: "#fff3d6",
  fillSolid: "#ffe9b3",
  accent: "#b6432a",
  labelBg: "#fbf7ee",
  font: "'Caveat', cursive",
};

/** Tiny deterministic string hash -> int32 seed for rough.js. */
export function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pathFromPoints(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

export function approxPillPath(x: number, y: number, w: number, h: number): string {
  const r = h / 2;
  const x0 = x - w / 2,
    x1 = x + w / 2,
    y0 = y - h / 2,
    y1 = y + h / 2;
  return [
    `M ${x0 + r} ${y0}`,
    `L ${x1 - r} ${y0}`,
    `A ${r} ${r} 0 0 1 ${x1 - r} ${y1}`,
    `L ${x0 + r} ${y1}`,
    `A ${r} ${r} 0 0 1 ${x0 + r} ${y0}`,
    "Z",
  ].join(" ");
}

export function makeSvgEl(document: Document, tag: string, attrs: Record<string, string> = {}): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function drawNode(
  svg: SVGSVGElement,
  rc: RoughCanvas,
  n: PositionedNode,
  theme: RenderTheme,
): void {
  const opts = (extra: Partial<Options> = {}): Options => ({
    seed: seedFrom(n.id) || 1,
    roughness: 1.6,
    bowing: 1.2,
    stroke: theme.ink,
    strokeWidth: 2,
    fill: theme.fill,
    fillStyle: "hachure",
    hachureGap: 5,
    hachureAngle: 41,
    ...extra,
  });
  const x = n.x - n.w / 2;
  const y = n.y - n.h / 2;
  let shape: SVGElement;
  if (n.kind === "ellipse") {
    shape = rc.ellipse(n.x, n.y, n.w, n.h, opts());
  } else if (n.kind === "pill") {
    shape = rc.path(approxPillPath(n.x, n.y, n.w, n.h), opts({ fillStyle: "solid", fill: theme.fillSolid }));
  } else {
    // box / card
    shape = rc.rectangle(x, y, n.w, n.h, opts(n.kind === "card" ? { fillStyle: "solid", fill: theme.fillSolid } : {}));
  }
  svg.appendChild(shape);

  // Label (Caveat handwriting font), centered, wrapped to ~22 chars.
  const labelLines = wrap(n.label, 22);
  const lineHeight = 22;
  const startY = n.y - ((labelLines.length - 1) * lineHeight) / 2 + 1;
  labelLines.forEach((line, i) => {
    const t = makeSvgEl(svg.ownerDocument, "text", {
      x: String(n.x),
      y: String(startY + i * lineHeight),
      "text-anchor": "middle",
      "font-family": theme.font,
      "font-size": "20",
      "font-weight": "700",
      fill: theme.ink,
    });
    t.textContent = line;
    svg.appendChild(t);
  });

  if (n.note) {
    const noteLines = wrap(n.note, 30);
    const noteStart = startY + labelLines.length * lineHeight + 6;
    noteLines.slice(0, 3).forEach((line, i) => {
      const t = makeSvgEl(svg.ownerDocument, "text", {
        x: String(n.x),
        y: String(noteStart + i * 15),
        "text-anchor": "middle",
        "font-family": theme.font,
        "font-size": "13",
        fill: theme.inkSoft,
      });
      t.textContent = line;
      svg.appendChild(t);
    });
  }
}

export function drawArrowhead(
  svg: SVGSVGElement,
  rc: RoughCanvas,
  tip: { x: number; y: number },
  from: { x: number; y: number },
  theme: RenderTheme,
  seed: number,
): void {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  const size = 13;
  const ang = 0.45; // ~26deg
  const cos = Math.cos(ang),
    sin = Math.sin(ang);
  const left = { x: tip.x - size * (ux * cos + uy * sin), y: tip.y - size * (uy * cos - ux * sin) };
  const right = { x: tip.x - size * (ux * cos - uy * sin), y: tip.y - size * (uy * cos + ux * sin) };
  const opts: Options = {
    seed: seed || 1,
    roughness: 1.4,
    stroke: theme.accent,
    strokeWidth: 2,
  };
  svg.appendChild(rc.line(tip.x, tip.y, left.x, left.y, opts));
  svg.appendChild(rc.line(tip.x, tip.y, right.x, right.y, opts));
}

export function drawEdge(
  svg: SVGSVGElement,
  rc: RoughCanvas,
  e: RoutedEdge,
  theme: RenderTheme,
): void {
  const seed = seedFrom(`${e.from}->${e.to}`) || 1;
  const isEmphasis = e.kind === "dashed";
  const opts: Options = {
    seed,
    roughness: 1.5,
    stroke: isEmphasis ? theme.accent : theme.ink,
    strokeWidth: 2,
  };
  // rough.js doesn't dash a path reliably across builds, so for dashed edges we fall back to
  // plain rough line segments between consecutive points (still sketched).
  if (isEmphasis) {
    for (let i = 0; i < e.points.length - 1; i++) {
      svg.appendChild(rc.line(e.points[i].x, e.points[i].y, e.points[i + 1].x, e.points[i + 1].y, opts));
    }
  } else {
    svg.appendChild(rc.path(pathFromPoints(e.points), opts));
  }

  // Arrowhead(s)
  const last = e.points[e.points.length - 1];
  const prev = e.points[e.points.length - 2] ?? e.points[0];
  drawArrowhead(svg, rc, last, prev, theme, seed);
  if (e.kind === "bidir") {
    const first = e.points[0];
    const second = e.points[1] ?? last;
    drawArrowhead(svg, rc, first, second, theme, seed + 7);
  }

  // Label at midpoint with a backing rect for legibility.
  if (e.label) {
    const mid = e.points[Math.floor(e.points.length / 2)];
    const doc = svg.ownerDocument;
    const label = makeSvgEl(doc, "text", {
      x: String(mid.x),
      y: String(mid.y - 6),
      "text-anchor": "middle",
      "font-family": theme.font,
      "font-size": "16",
      fill: theme.ink,
    });
    label.textContent = e.label;
    // Backing: measure is awkward in jsdom; approximate by label length.
    const w = Math.max(34, e.label.length * 9 + 10);
    const back = makeSvgEl(doc, "rect", {
      x: String(mid.x - w / 2),
      y: String(mid.y - 22),
      width: String(w),
      height: "20",
      rx: "6",
      fill: theme.labelBg,
      opacity: "0.92",
    });
    svg.appendChild(back);
    svg.appendChild(label);
  }
}

export function drawGroup(
  svg: SVGSVGElement,
  rc: RoughCanvas,
  g: PositionedGraph["groups"][number],
  theme: RenderTheme,
): void {
  const seed = seedFrom(`grp:${g.id}`) || 1;
  svg.appendChild(
    rc.rectangle(g.x, g.y, g.w, g.h, {
      seed,
      roughness: 2,
      stroke: theme.inkSoft,
      strokeWidth: 1.5,
      fill: "none",
    }),
  );
  if (g.label) {
    const t = makeSvgEl(svg.ownerDocument, "text", {
      x: String(g.x + 10),
      y: String(g.y - 8),
      "font-family": theme.font,
      "font-size": "15",
      fill: theme.inkSoft,
    });
    t.textContent = g.label;
    svg.appendChild(t);
  }
}

export function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

export interface RenderOptions {
  theme?: Partial<RenderTheme>;
}

/**
 * Clear `svg` and render the positioned graph into it. Sets viewBox + background.
 * Safe to call repeatedly (e.g. on "regenerate layout") — it wipes first.
 */
export function drawConcept(svg: SVGSVGElement, graph: PositionedGraph, opts: RenderOptions = {}): void {
  const theme = { ...DEFAULT_THEME, ...opts.theme };
  const doc = svg.ownerDocument;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  svg.setAttribute("viewBox", `0 0 ${Math.ceil(graph.width)} ${Math.ceil(graph.height)}`);
  svg.setAttribute("width", String(Math.ceil(graph.width)));
  svg.setAttribute("height", String(Math.ceil(graph.height)));
  svg.setAttribute("style", `background:${theme.paper};`);

  // Background rect (so exporters/screenshots pick up the paper color).
  svg.appendChild(
    makeSvgEl(doc, "rect", {
      x: "0",
      y: "0",
      width: String(Math.ceil(graph.width)),
      height: String(Math.ceil(graph.height)),
      fill: theme.paper,
    }),
  );

  const rc = rough.svg(svg);

  // Order: canvas primitives (background: axes, number lines, …) -> groups -> edges -> nodes.
  for (const p of graph.primitives ?? []) {
    const fn = CANVAS_PRIMITIVES.get(p.kind);
    if (fn) fn(svg, rc, p, theme, graph);
  }
  for (const g of graph.groups) drawGroup(svg, rc, g, theme);
  for (const e of graph.edges) {
    const fn = e.primitive ? EDGE_PRIMITIVES.get(e.primitive) : undefined;
    (fn ?? drawEdge)(svg, rc, e, theme);
  }
  for (const n of graph.nodes) {
    const fn = n.primitive ? NODE_PRIMITIVES.get(n.primitive) : undefined;
    (fn ?? drawNode)(svg, rc, n, theme);
  }
}