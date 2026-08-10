/**
 * Grid primitive — a matrix / table of cells (access-control matrix, k-way cache table, truth
 * table, …). Each node is one cell. Cells flow into `domain.cols` columns (or an auto near-square
 * when omitted); a per-node `domain.cell {r,c}` pins a specific position. Headers are just cells
 * in the first row/column. The model emits no coordinates.
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
  registerNodePrimitive,
  seedFrom,
  wrap,
  makeSvgEl,
} from "../render";

interface CellPos {
  r: number;
  c: number;
}

interface GridDomain {
  cols?: number;
  positions?: Record<string, { r: number; c: number }>;
}

/** Layout cells into a grid. */
export function layoutGrid(doc: ConceptDoc): PositionedGraph {
  const grid = (doc.domain as { grid?: unknown } | undefined)?.grid as GridDomain | undefined;
  const n = doc.nodes.length;
  const cols = grid?.cols && grid.cols > 0 ? grid.cols : Math.max(1, Math.ceil(Math.sqrt(n)));
  const pin = grid?.positions ?? {};

  let maxW = 90,
    maxH = 44;
  for (const node of doc.nodes) {
    const m = measureNode(node);
    maxW = Math.max(maxW, m.w);
    maxH = Math.max(maxH, m.h);
  }
  const cellW = maxW + 12;
  const cellH = maxH + 8;

  // Resolve each cell's (r,c): pinned via domain.grid.positions[id], else auto-flow.
  const positions = new Map<string, CellPos>();
  const pinned = new Set<string>();
  for (const node of doc.nodes) {
    const p = pin[node.id];
    if (p && typeof p.r === "number" && typeof p.c === "number") {
      positions.set(node.id, { r: p.r, c: p.c });
      pinned.add(node.id);
    }
  }
  let auto = 0;
  for (const node of doc.nodes) {
    if (pinned.has(node.id)) continue;
    let r = Math.floor(auto / cols);
    let c = auto % cols;
    while ([...positions.values()].some((p) => p.r === r && p.c === c)) {
      auto++;
      r = Math.floor(auto / cols);
      c = auto % cols;
    }
    positions.set(node.id, { r, c });
    auto++;
  }

  const nodes: PositionedNode[] = doc.nodes.map((node) => {
    const m = measureNode(node);
    const p = positions.get(node.id)!;
    return {
      id: node.id,
      label: node.label,
      kind: defaultKind(node),
      ...(node.note ? { note: node.note } : {}),
      x: p.c * cellW,
      y: p.r * cellH,
      w: Math.min(m.w + 8, cellW),
      h: Math.min(m.h, cellH),
      primitive: "gridCell",
    };
  });
  const nodeMap = new Map(nodes.map((nn) => [nn.id, nn]));
  const edges: RoutedEdge[] = routeEdges(doc, nodeMap);
  const box = shiftAndBox(nodes, [], edges);
  return { diagramType: "flow", ...box };
}

/** Draw a grid cell: a compact sketched rectangle with a centered label (no note block). */
function drawGridCell(svg: SVGSVGElement, rc: RoughCanvas, n: PositionedNode, theme: RenderTheme): void {
  const seed = seedFrom(`cell:${n.id}`) || 1;
  const x = n.x - n.w / 2;
  const y = n.y - n.h / 2;
  svg.appendChild(
    rc.rectangle(x, y, n.w, n.h, {
      seed,
      roughness: 1.3,
      stroke: theme.ink,
      strokeWidth: 1.6,
      fill: theme.fill,
      fillStyle: "hachure",
      hachureGap: 6,
      hachureAngle: 41,
    }),
  );
  const lines = wrap(n.label, Math.max(8, Math.floor(n.w / 8)));
  const lh = 18;
  const startY = n.y - ((lines.length - 1) * lh) / 2 + 1;
  lines.forEach((line, i) => {
    const t = makeSvgEl(svg.ownerDocument, "text", {
      x: String(n.x),
      y: String(startY + i * lh),
      "text-anchor": "middle",
      "font-family": theme.font,
      "font-size": "16",
      "font-weight": "700",
      fill: theme.ink,
    });
    t.textContent = line;
    svg.appendChild(t);
  });
}

registerNodePrimitive("gridCell", drawGridCell);