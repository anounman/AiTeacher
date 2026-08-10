/**
 * State-machine primitive — states + transitions (OS process states, DFA, Markov chain, …).
 *
 * States are laid out in an auto near-square grid (or `domain.cols` columns). Self-transitions
 * render as a small loop above the state; accepting/final states get a double ring
 * (`domain.accepting` = list of ids). The model emits no coordinates.
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
  shiftAndBox,
} from "../layout";
import {
  type RenderTheme,
  type RoughCanvas,
  drawArrowhead,
  makeSvgEl,
  registerNodePrimitive,
  registerEdgePrimitive,
  seedFrom,
  wrap,
} from "../render";

/** Layout states in a grid; self-loops get a loop path, others a straight edge. */
export function layoutStateMachine(doc: ConceptDoc): PositionedGraph {
  const domain = doc.domain as { cols?: unknown; accepting?: unknown } | undefined;
  const n = doc.nodes.length;
  const cols = typeof domain?.cols === "number" && domain.cols > 0 ? domain.cols : Math.max(1, Math.ceil(Math.sqrt(n)));
  const accepting = new Set<string>(
    Array.isArray(domain?.accepting) ? (domain.accepting as unknown[]).filter((x): x is string => typeof x === "string") : [],
  );

  let maxW = 110,
    maxH = 56;
  for (const node of doc.nodes) {
    const m = measureNode(node);
    maxW = Math.max(maxW, m.w);
    maxH = Math.max(maxH, m.h);
  }
  const cellW = maxW + 90;
  const cellH = maxH + 80;

  const nodes: PositionedNode[] = doc.nodes.map((node, i) => {
    const m = measureNode(node);
    const r = Math.floor(i / cols);
    const c = i % cols;
    const isAccept = accepting.has(node.id);
    return {
      id: node.id,
      label: node.label,
      kind: defaultKind(node),
      ...(node.note ? { note: node.note } : {}),
      x: c * cellW,
      y: r * cellH,
      w: m.w,
      h: m.h,
      primitive: "stateNode",
      domainData: { accepting: isAccept },
    };
  });
  const nodeMap = new Map(nodes.map((nn) => [nn.id, nn]));

  const edges: RoutedEdge[] = doc.edges.map((e) => {
    const a = nodeMap.get(e.from)!;
    const b = nodeMap.get(e.to)!;
    let pts: Point[];
    let primitive: string | undefined;
    if (e.from === e.to) {
      // self-loop: up and around above the state
      const topY = a.y - a.h / 2;
      pts = [
        { x: a.x - 6, y: topY },
        { x: a.x - 26, y: topY - 28 },
        { x: a.x + 26, y: topY - 28 },
        { x: a.x + 6, y: topY },
      ];
      primitive = "selfLoop";
    } else {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx === 0 && dy === 0) {
        pts = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
      } else {
        const hw = a.w / 2, hh = a.h / 2;
        const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
        const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
        const s = Math.min(sx, sy);
        const ex = (b.w / 2) / Math.max(1, Math.abs(dx));
        const ey = (b.h / 2) / Math.max(1, Math.abs(dy));
        const e2 = Math.min(ex, ey);
        pts = [
          { x: a.x + dx * s, y: a.y + dy * s },
          { x: b.x - dx * e2, y: b.y - dy * e2 },
        ];
      }
      primitive = "stateEdge";
    }
    return {
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
      kind: defaultEdgeKind(e),
      points: pts,
      primitive,
    };
  });

  const box = shiftAndBox(nodes, [], edges);
  return { diagramType: "flow", ...box };
}

/** Draw a state: a rough ellipse + label; a double ring if accepting. */
function drawStateNode(svg: SVGSVGElement, rc: RoughCanvas, n: PositionedNode, theme: RenderTheme): void {
  const seed = seedFrom(`state:${n.id}`) || 1;
  const opts = {
    seed,
    roughness: 1.4,
    stroke: theme.ink,
    strokeWidth: 2,
    fill: theme.fill,
    fillStyle: "hachure",
    hachureGap: 6,
    hachureAngle: 41,
  };
  svg.appendChild(rc.ellipse(n.x, n.y, n.w, n.h, opts));
  if (n.domainData?.accepting) {
    svg.appendChild(rc.ellipse(n.x, n.y, n.w - 14, n.h - 12, { ...opts, fill: "none", seed: seed + 7 }));
  }
  const lines = wrap(n.label, Math.max(8, Math.floor(n.w / 9)));
  const lh = 18;
  const startY = n.y - ((lines.length - 1) * lh) / 2 + 1;
  lines.forEach((line, i) => {
    const t = makeSvgEl(svg.ownerDocument, "text", {
      x: String(n.x),
      y: String(startY + i * lh),
      "text-anchor": "middle",
      "font-family": theme.font,
      "font-size": "17",
      "font-weight": "700",
      fill: theme.ink,
    });
    t.textContent = line;
    svg.appendChild(t);
  });
}

/** Draw a transition edge: a straight sketched arrow + label near the midpoint. */
function drawStateEdge(svg: SVGSVGElement, rc: RoughCanvas, e: RoutedEdge, theme: RenderTheme): void {
  const seed = seedFrom(`se:${e.from}->${e.to}`) || 1;
  const a = e.points[0];
  const b = e.points[e.points.length - 1];
  svg.appendChild(rc.line(a.x, a.y, b.x, b.y, { seed, roughness: 1.3, stroke: theme.ink, strokeWidth: 2 }));
  drawArrowhead(svg, rc, b, a, theme, seed);
  if (e.label) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6 };
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
    const w = Math.max(28, e.label.length * 8 + 8);
    svg.appendChild(makeSvgEl(doc, "rect", { x: String(mid.x - w / 2), y: String(mid.y - 15), width: String(w), height: "17", rx: "6", fill: theme.labelBg, opacity: "0.92" }));
    svg.appendChild(t);
  }
}

/** Draw a self-loop: a small sketched loop above the state with an arrowhead back into it. */
function drawSelfLoop(svg: SVGSVGElement, rc: RoughCanvas, e: RoutedEdge, theme: RenderTheme): void {
  const seed = seedFrom(`sl:${e.from}->${e.to}`) || 1;
  const pts = e.points;
  // Sketched loop as three rough segments (rough.js has no curved path primitive).
  for (let i = 0; i < pts.length - 1; i++) {
    svg.appendChild(rc.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, { seed: seed + i, roughness: 1.3, stroke: theme.ink, strokeWidth: 2 }));
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  drawArrowhead(svg, rc, last, prev, theme, seed);
  if (e.label) {
    const top = pts[1];
    const t = makeSvgEl(svg.ownerDocument, "text", {
      x: String((pts[1].x + pts[2].x) / 2),
      y: String(top.y - 6),
      "text-anchor": "middle",
      "font-family": theme.font,
      "font-size": "14",
      fill: theme.ink,
    });
    t.textContent = e.label;
    svg.appendChild(t);
  }
}

registerNodePrimitive("stateNode", drawStateNode);
registerEdgePrimitive("stateEdge", drawStateEdge);
registerEdgePrimitive("selfLoop", drawSelfLoop);