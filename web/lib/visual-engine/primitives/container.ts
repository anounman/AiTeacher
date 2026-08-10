/**
 * Container primitive — memory regions / aggregate blocks (refs, arrays, heap/stack segments).
 *
 * Containers are laid out as a vertical stack of labeled boxes with room for notes (the classic
 * "stack | heap | data" memory picture). A 1D array is a single-row grid (handled by the grid
 * primitive in a later phase); here we draw each node as one container. The model emits no
 * coordinates.
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

/** Layout containers as a vertical stack with generous spacing for notes/labels. */
export function layoutMemory(doc: ConceptDoc): PositionedGraph {
  let maxW = 240,
    maxH = 56;
  for (const n of doc.nodes) {
    const m = measureNode(n);
    maxW = Math.max(maxW, m.w);
    maxH = Math.max(maxH, m.h);
  }
  const contW = maxW + 60;
  const gap = maxH + 56;

  const nodes = doc.nodes.map((n, i) => {
    const m = measureNode(n);
    return {
      id: n.id,
      label: n.label,
      kind: defaultKind(n),
      ...(n.note ? { note: n.note } : {}),
      x: 0,
      y: i * gap,
      w: contW,
      h: Math.max(m.h, maxH),
      primitive: "container",
    };
  });
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: RoutedEdge[] = routeEdges(doc, nodeMap);
  const box = shiftAndBox(nodes, [], edges);
  return { diagramType: "flow", ...box };
}

function drawContainer(
  svg: SVGSVGElement,
  rc: RoughCanvas,
  n: { id: string; label: string; note?: string; x: number; y: number; w: number; h: number; kind: "box" | "ellipse" | "pill" | "card" },
  theme: RenderTheme,
): void {
  drawNode(svg, rc, n, theme);
}

registerNodePrimitive("container", drawContainer);