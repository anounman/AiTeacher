/**
 * Stack primitive — vertical frames (call stack, operand/stack machine).
 *
 * Frames are stacked top-to-bottom as wide, thin bars (the classic call-stack look). Order comes
 * from `domain.order` (array of node ids, bottom-of-stack first) or falls back to node order. The
 * model emits no coordinates; layout is deterministic.
 */
import type { ConceptDoc } from "../schema";
import {
  type PositionedGraph,
  type RoutedEdge,
  defaultKind,
  measureNode,
  routeEdges,
  shiftAndBox,
} from "../layout";
import { drawNode, registerNodePrimitive, type RoughCanvas, type RenderTheme } from "../render";

function orderOf(doc: ConceptDoc): string[] {
  const domain = doc.domain as { order?: unknown } | undefined;
  const ids = new Set(doc.nodes.map((n) => n.id));
  const order: string[] = [];
  if (Array.isArray(domain?.order)) {
    for (const x of domain.order) {
      if (typeof x === "string" && ids.has(x) && !order.includes(x)) order.push(x);
    }
  }
  for (const n of doc.nodes) if (!order.includes(n.id)) order.push(n.id);
  return order;
}

/** Layout frames as a vertical stack of wide bars. */
export function layoutStack(doc: ConceptDoc): PositionedGraph {
  const order = orderOf(doc);
  let maxW = 220,
    maxH = 48;
  for (const n of doc.nodes) {
    const m = measureNode(n);
    maxW = Math.max(maxW, m.w);
    maxH = Math.max(maxH, m.h);
  }
  const frameW = maxW + 40;
  const frameH = maxH;
  const gap = 10;

  const idx = new Map<string, number>();
  order.forEach((id, i) => idx.set(id, i));

  const nodes = doc.nodes.map((n) => {
    const i = idx.get(n.id) ?? 0;
    return {
      id: n.id,
      label: n.label,
      kind: defaultKind(n),
      ...(n.note ? { note: n.note } : {}),
      x: 0,
      y: i * (frameH + gap),
      w: frameW,
      h: frameH,
      primitive: "stackFrame",
    };
  });
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: RoutedEdge[] = routeEdges(doc, nodeMap);
  const box = shiftAndBox(nodes, [], edges);
  return { diagramType: "flow", ...box };
}

function drawStackFrame(
  svg: SVGSVGElement,
  rc: RoughCanvas,
  n: { id: string; label: string; note?: string; x: number; y: number; w: number; h: number; kind: "box" | "ellipse" | "pill" | "card" },
  theme: RenderTheme,
): void {
  // A stack frame is just a wide sketched bar — the default node draw already does this well.
  drawNode(svg, rc, n, theme);
}

registerNodePrimitive("stackFrame", drawStackFrame);