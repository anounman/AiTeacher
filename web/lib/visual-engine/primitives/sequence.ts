/**
 * Sequence primitive — UML-style lifelines + messages.
 *
 * Each node is an actor/instance rendered as a head box atop a vertical lifeline. Edges are
 * messages: horizontal arrows from one lifeline to another at increasing depths (in edge order,
 * or domain.order of edge indices). Self-messages render as a small loop. The model emits no
 * coordinates — only the actor list and the ordered messages.
 */
import type { ConceptDoc } from "../schema";
import {
  type Point,
  type PositionedGraph,
  type PositionedNode,
  type RoutedEdge,
  defaultEdgeKind,
  defaultKind,
  measureNode,
} from "../layout";
import {
  type RenderTheme,
  type RoughCanvas,
  drawArrowhead,
  drawNode,
  makeSvgEl,
  pathFromPoints,
  registerEdgePrimitive,
  registerNodePrimitive,
  seedFrom,
} from "../render";
import type { Options } from "roughjs/bin/core.js";

/** Order lifelines by domain.order (array of node ids), else node order. */
function laneOrder(doc: ConceptDoc): string[] {
  const domain = doc.domain as { order?: unknown } | undefined;
  const ids = new Set(doc.nodes.map((n) => n.id));
  const order: string[] = [];
  if (Array.isArray(domain?.order)) {
    for (const x of domain.order) if (typeof x === "string" && ids.has(x) && !order.includes(x)) order.push(x);
  }
  for (const n of doc.nodes) if (!order.includes(n.id)) order.push(n.id);
  return order;
}

/** Layout lifelines + messages. */
export function layoutSequence(doc: ConceptDoc): PositionedGraph {
  const order = laneOrder(doc);
  const laneIdx = new Map<string, number>();
  order.forEach((id, i) => laneIdx.set(id, i));

  let maxW = 120,
    maxH = 48;
  for (const n of doc.nodes) {
    const m = measureNode(n);
    maxW = Math.max(maxW, m.w);
    maxH = Math.max(maxH, m.h);
  }
  const laneW = maxW + 70;
  const headH = maxH;
  const msgGap = 62;

  const laneX = (id: string) => (laneIdx.get(id) ?? 0) * laneW;

  // Messages at increasing depths (edge order).
  const messageCount = doc.edges.length;
  const bottomY = headH + (messageCount + 1) * msgGap;

  const nodes: PositionedNode[] = doc.nodes.map((n) => {
    const m = measureNode(n);
    return {
      id: n.id,
      label: n.label,
      kind: defaultKind(n),
      ...(n.note ? { note: n.note } : {}),
      x: laneX(n.id),
      y: 0,
      w: m.w,
      h: m.h,
      primitive: "lifeline",
      domainData: { bottomY },
    };
  });
  const edges: RoutedEdge[] = doc.edges.map((e, k) => {
    const y = headH / 2 + (k + 1) * msgGap + headH / 2;
    const ax = laneX(e.from);
    const bx = laneX(e.to);
    let pts: Point[];
    if (e.from === e.to) {
      // self-message: a small loop to the right of the lifeline
      const off = 46;
      pts = [
        { x: ax, y },
        { x: ax + off, y },
        { x: ax + off, y: y + 26 },
        { x: ax, y: y + 26 },
      ];
    } else {
      pts = [
        { x: ax, y },
        { x: bx, y },
      ];
    }
    return {
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
      kind: defaultEdgeKind(e),
      points: pts,
      primitive: "message",
      domainData: { y },
    };
  });

  // Bounds must include the lifeline bottoms and message points (shiftAndBox only looks at
  // nodes, so compute the full extent here, then shift nodes + edge points together).
  const PAD = 48;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  for (const e of edges) for (const p of e.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  // Lifelines extend to bottomY below the heads.
  for (const n of nodes) maxY = Math.max(maxY, (n.domainData?.bottomY as number) ?? n.y);
  const dx = PAD - minX;
  const dy = PAD - minY;
  for (const n of nodes) {
    n.x += dx;
    n.y += dy;
    if (n.domainData) n.domainData = { ...n.domainData, bottomY: (n.domainData.bottomY as number) + dy };
  }
  for (const e of edges) for (const p of e.points) {
    p.x += dx;
    p.y += dy;
  }
  return {
    diagramType: "flow",
    width: maxX - minX + PAD * 2,
    height: maxY - minY + PAD * 2,
    nodes,
    edges,
    groups: [],
  };
}

/** Draw a lifeline: head box (default node) + a vertical line down to bottomY. */
function drawLifeline(svg: SVGSVGElement, rc: RoughCanvas, n: PositionedNode, theme: RenderTheme): void {
  drawNode(svg, rc, n, theme);
  const bottomY = (n.domainData?.bottomY as number | undefined) ?? n.y + n.h + 200;
  const topY = n.y + n.h / 2;
  if (bottomY > topY) {
    svg.appendChild(
      rc.line(n.x, topY, n.x, bottomY, {
        seed: seedFrom(`life:${n.id}`) || 1,
        roughness: 0.6,
        stroke: theme.inkSoft,
        strokeWidth: 1.4,
      }),
    );
  }
}

/** Draw a message: horizontal arrow + label (or a self-loop). */
function drawMessage(svg: SVGSVGElement, rc: RoughCanvas, e: RoutedEdge, theme: RenderTheme): void {
  const seed = seedFrom(`msg:${e.from}->${e.to}`) || 1;
  const opts: Options = { seed, roughness: 1.3, stroke: theme.ink, strokeWidth: 2 };
  svg.appendChild(rc.path(pathFromPoints(e.points), opts));
  const last = e.points[e.points.length - 1];
  const prev = e.points[e.points.length - 2] ?? e.points[0];
  drawArrowhead(svg, rc, last, prev, theme, seed);
  if (e.label) {
    const a = e.points[0];
    const mid = { x: (a.x + last.x) / 2, y: a.y - 6 };
    const doc = svg.ownerDocument;
    const t = makeSvgEl(doc, "text", {
      x: String(mid.x),
      y: String(mid.y),
      "text-anchor": "middle",
      "font-family": theme.font,
      "font-size": "15",
      fill: theme.ink,
    });
    t.textContent = e.label;
    const w = Math.max(30, e.label.length * 8 + 10);
    svg.appendChild(
      makeSvgEl(doc, "rect", {
        x: String(mid.x - w / 2),
        y: String(mid.y - 16),
        width: String(w),
        height: "18",
        rx: "6",
        fill: theme.labelBg,
        opacity: "0.92",
      }),
    );
    svg.appendChild(t);
  }
}

registerNodePrimitive("lifeline", drawLifeline);
registerEdgePrimitive("message", drawMessage);