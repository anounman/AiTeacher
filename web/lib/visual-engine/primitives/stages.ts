/**
 * Stages primitive — a horizontal pipeline of uniform stage blocks (cipher rounds, CPU pipeline
 * stages, …). Each node is one stage; edges flow left→right between consecutive stages. The node
 * carries its 1-based index as a small badge so the pipeline order reads at a glance.
 */
import type { ConceptDoc } from "../schema";
import {
  type PositionedGraph,
  type PositionedNode,
  type RoutedEdge,
  defaultKind,
  measureNode,
  routeEdges,
  shiftAndBox,
} from "../layout";
import {
  type RenderTheme,
  type RoughCanvas,
  drawArrowhead,
  drawNode,
  makeSvgEl,
  registerNodePrimitive,
  registerEdgePrimitive,
  seedFrom,
} from "../render";
import type { Options } from "roughjs/bin/core.js";

/** Order stages by domain.order (array of node ids), else node order. */
function stageOrder(doc: ConceptDoc): string[] {
  const domain = doc.domain as { order?: unknown } | undefined;
  const ids = new Set(doc.nodes.map((n) => n.id));
  const order: string[] = [];
  if (Array.isArray(domain?.order)) {
    for (const x of domain.order) if (typeof x === "string" && ids.has(x) && !order.includes(x)) order.push(x);
  }
  for (const n of doc.nodes) if (!order.includes(n.id)) order.push(n.id);
  return order;
}

/** Layout stages as a uniform horizontal row. */
export function layoutStages(doc: ConceptDoc): PositionedGraph {
  const order = stageOrder(doc);
  const idx = new Map<string, number>();
  order.forEach((id, i) => idx.set(id, i));

  let maxW = 150,
    maxH = 56;
  for (const n of doc.nodes) {
    const m = measureNode(n);
    maxW = Math.max(maxW, m.w);
    maxH = Math.max(maxH, m.h);
  }
  const w = maxW + 20;
  const h = maxH;
  const gap = 70;
  const stageW = w + gap;

  const nodes = doc.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: defaultKind(n),
    ...(n.note ? { note: n.note } : {}),
    x: (idx.get(n.id) ?? 0) * stageW,
    y: 0,
    w,
    h,
    primitive: "stageBlock",
    domainData: { index: (idx.get(n.id) ?? 0) + 1 },
  }));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: RoutedEdge[] = routeEdges(doc, nodeMap);
  const box = shiftAndBox(nodes, [], edges);
  return { diagramType: "flow", ...box };
}

/** Draw a stage block: a sketched box + a 1-based index badge in the top-left corner. */
function drawStageBlock(svg: SVGSVGElement, rc: RoughCanvas, n: PositionedNode, theme: RenderTheme): void {
  drawNode(svg, rc, n, theme);
  const index = (n.domainData?.index as number | undefined) ?? 1;
  const cx = n.x - n.w / 2 + 14;
  const cy = n.y - n.h / 2 + 14;
  svg.appendChild(
    rc.circle(cx, cy, 22, {
      seed: seedFrom(`stage:${n.id}`) || 1,
      roughness: 1.2,
      stroke: theme.accent,
      strokeWidth: 2,
      fill: theme.labelBg,
      fillStyle: "solid",
    }),
  );
  const t = makeSvgEl(svg.ownerDocument, "text", {
    x: String(cx),
    y: String(cy + 5),
    "text-anchor": "middle",
    "font-family": theme.font,
    "font-size": "14",
    "font-weight": "700",
    fill: theme.accent,
  });
  t.textContent = String(index);
  svg.appendChild(t);
}

/** Stage edges: a straight sketched arrow between stages (cleaner than the default polyline). */
function drawStageEdge(svg: SVGSVGElement, rc: RoughCanvas, e: RoutedEdge, theme: RenderTheme): void {
  const seed = seedFrom(`stage:${e.from}->${e.to}`) || 1;
  const opts: Options = { seed, roughness: 1.2, stroke: theme.ink, strokeWidth: 2 };
  const a = e.points[0];
  const b = e.points[e.points.length - 1];
  svg.appendChild(rc.line(a.x, a.y, b.x, b.y, opts));
  drawArrowhead(svg, rc, b, a, theme, seed);
  if (e.label) {
    const mid = { x: (a.x + b.x) / 2, y: a.y - 8 };
    const doc = svg.ownerDocument;
    const t = makeSvgEl(doc, "text", {
      x: String(mid.x),
      y: String(mid.y),
      "text-anchor": "middle",
      "font-family": theme.font,
      "font-size": "14",
      fill: theme.ink,
    });
    t.textContent = e.label;
    svg.appendChild(t);
  }
}

registerNodePrimitive("stageBlock", drawStageBlock);
registerEdgePrimitive("stageEdge", drawStageEdge);