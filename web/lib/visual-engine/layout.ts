/**
 * Stage 2 — Layout: turn a ConceptDoc into a PositionedGraph with exact coordinates.
 *
 * Fully deterministic (no Math.random, no force simulation): the LLM never positions anything,
 * and this stage always produces non-overlapping, reproducible bounds. Strategies:
 *   hierarchy  -> dagre layered (TB)
 *   flow       -> dagre layered (LR)
 *   comparison -> manual two-column by groups (fallback dagre LR if no groups)
 *   cycle      -> manual circular (nodes on a ring, edges as chords)
 *   timeline   -> manual left-to-right lane, ordered by steps[].at
 *   mindmap    -> deterministic radial (BFS levels from a center node)
 *
 * diagramType can be overridden from the graph shape (a real cycle under a "hierarchy" hint
 * becomes "cycle") so a model's bad hint can't produce a broken tree layout.
 *
 * Framework-agnostic; merges into AiTeacher's lib/ unchanged.
 */
import dagre from "dagre";
import type { ConceptDoc, DiagramType, Edge, Node } from "./schema";
import { getTemplate } from "./registry";

export interface Point {
  x: number;
  y: number;
}

/** A canvas-level primitive drawn as background (axes, number lines, brackets). */
export interface PositionedPrimitive {
  kind: string;
  data: Record<string, unknown>;
}

export interface PositionedNode {
  id: string;
  label: string;
  kind: NonNullable<Node["kind"]>;
  note?: string;
  x: number; // center
  y: number; // center
  w: number;
  h: number;
  /** Render primitive kind (looked up in PRIMITIVE_REGISTRY); absent -> default drawNode. */
  primitive?: string;
  /** Per-node structured data passed through from doc.domain for the primitive. */
  domainData?: Record<string, unknown>;
}

export interface RoutedEdge {
  from: string;
  to: string;
  label?: string;
  kind: NonNullable<Edge["kind"]>;
  points: Point[]; // polyline from source border to target border (inclusive)
  /** Render primitive kind; absent -> default drawEdge. */
  primitive?: string;
  domainData?: Record<string, unknown>;
}

export interface PositionedGroup {
  id: string;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PositionedGraph {
  diagramType: DiagramType;
  width: number;
  height: number;
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  groups: PositionedGroup[];
  /** Canvas-level primitives (axes, etc.) drawn first as background. */
  primitives?: PositionedPrimitive[];
}

const PADDING = 48;

/** Measure a node from its label/note. Deterministic. */
export function measureNode(n: Node): { w: number; h: number } {
  const labelLines = Math.ceil(n.label.length / 22);
  const w = Math.max(110, Math.min(240, n.label.length * 8.2 + 28));
  let h = 24 + labelLines * 20 + 20;
  if (n.note) {
    const noteLines = Math.ceil(n.note.length / 30);
    h += 8 + noteLines * 16;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

function defaultKind(n: Node): NonNullable<Node["kind"]> {
  return n.kind ?? (n.label.length <= 18 ? "box" : "card");
}
function defaultEdgeKind(e: Edge): NonNullable<Edge["kind"]> {
  return e.kind ?? "solid";
}
// Re-exported for pack/primitive modules that build their own layouts.
export { defaultKind, defaultEdgeKind };

/** Does the directed graph contain a cycle? (DFS) */
export function hasCycle(doc: ConceptDoc): boolean {
  const adj = new Map<string, string[]>();
  for (const n of doc.nodes) adj.set(n.id, []);
  for (const e of doc.edges) adj.get(e.from)?.push(e.to);
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const n of doc.nodes) color.set(n.id, WHITE);
  const dfs = (u: string): boolean => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  };
  for (const n of doc.nodes) if (color.get(n.id) === WHITE && dfs(n.id)) return true;
  return false;
}

/** Resolve the effective diagram type, overriding a bad hint from the graph shape. */
export function resolveDiagramType(doc: ConceptDoc): DiagramType {
  if (hasCycle(doc) && doc.diagramType === "hierarchy") return "cycle";
  if (doc.diagramType === "timeline" && (!doc.steps || doc.steps.length === 0)) {
    // No steps -> can't do a timeline; treat as flow.
    return "flow";
  }
  return doc.diagramType;
}

export function borderPoint(
  from: Point,
  to: Point,
  w: number,
  h: number,
): Point {
  // Intersection of the line from->to with the rectangle (w x h) centered at `from`.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const hw = w / 2;
  const hh = h / 2;
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

export function routeEdges(
  doc: ConceptDoc,
  nodes: Map<string, PositionedNode>,
  edgePoints?: Map<string, Point[]>,
): RoutedEdge[] {
  return doc.edges.map((e) => {
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    let pts: Point[];
    if (edgePoints && edgePoints.has(`${e.from}${e.to}`)) {
      pts = edgePoints.get(`${e.from}${e.to}`)!;
    } else {
      pts = [
        borderPoint({ x: a.x, y: a.y }, { x: b.x, y: b.y }, a.w, a.h),
        borderPoint({ x: b.x, y: b.y }, { x: a.x, y: a.y }, b.w, b.h),
      ];
    }
    return {
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
      kind: defaultEdgeKind(e),
      points: pts,
    };
  });
}

export function boundsOf(nodes: PositionedNode[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function shiftAndBox(
  nodes: PositionedNode[],
  groups: PositionedGroup[],
  edges: RoutedEdge[],
): Pick<PositionedGraph, "width" | "height" | "nodes" | "edges" | "groups"> {
  const b = boundsOf(nodes);
  const dx = PADDING - b.x;
  const dy = PADDING - b.y;
  for (const n of nodes) {
    n.x += dx;
    n.y += dy;
  }
  for (const g of groups) {
    g.x += dx;
    g.y += dy;
  }
  for (const e of edges) {
    for (const p of e.points) {
      p.x += dx;
      p.y += dy;
    }
  }
  const width = b.w + PADDING * 2;
  const height = b.h + PADDING * 2;
  return { width, height, nodes, edges, groups };
}

export function buildGroups(doc: ConceptDoc, nodes: Map<string, PositionedNode>): PositionedGroup[] {
  if (!doc.groups) return [];
  const out: PositionedGroup[] = [];
  for (const g of doc.groups) {
    const members = g.members
      .map((id) => nodes.get(id))
      .filter((n): n is PositionedNode => !!n);
    if (members.length === 0) continue;
    const b = boundsOf(members);
    out.push({
      id: g.id,
      ...(g.label ? { label: g.label } : {}),
      x: b.x - 18,
      y: b.y - 26,
      w: b.w + 36,
      h: b.h + 44,
    });
  }
  return out;
}

/* --------------------------- strategies --------------------------- */

export function layoutDagre(doc: ConceptDoc, rankdir: "TB" | "LR"): PositionedGraph {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 55, ranksep: 75, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const sizes = new Map<string, { w: number; h: number }>();
  for (const n of doc.nodes) {
    const m = measureNode(n);
    sizes.set(n.id, m);
    g.setNode(n.id, { width: m.w, height: m.h });
  }
  for (const e of doc.edges) g.setEdge(e.from, e.to);
  dagre.layout(g);

  const nodes = new Map<string, PositionedNode>();
  for (const n of doc.nodes) {
    const pos = g.node(n.id);
    const m = sizes.get(n.id)!;
    nodes.set(n.id, {
      id: n.id,
      label: n.label,
      kind: defaultKind(n),
      ...(n.note ? { note: n.note } : {}),
      x: pos.x,
      y: pos.y,
      w: m.w,
      h: m.h,
    });
  }
  const edgePoints = new Map<string, Point[]>();
  for (const e of doc.edges) {
    const ep = g.edge(e.from, e.to);
    if (ep && Array.isArray(ep.points)) edgePoints.set(`${e.from}${e.to}`, ep.points);
  }
  const edges = routeEdges(doc, nodes, edgePoints);
  const groups = buildGroups(doc, nodes);
  const box = shiftAndBox([...nodes.values()], groups, edges);
  return { diagramType: rankdir === "TB" ? "hierarchy" : "flow", ...box };
}

export function layoutCircular(doc: ConceptDoc): PositionedGraph {
  const nodes = new Map<string, PositionedNode>();
  const n = doc.nodes.length;
  const radius = Math.max(180, n * 55);
  doc.nodes.forEach((node, i) => {
    const m = measureNode(node);
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    nodes.set(node.id, {
      id: node.id,
      label: node.label,
      kind: defaultKind(node),
      ...(node.note ? { note: node.note } : {}),
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      w: m.w,
      h: m.h,
    });
  });
  const edges = routeEdges(doc, nodes);
  const groups = buildGroups(doc, nodes);
  const box = shiftAndBox([...nodes.values()], groups, edges);
  return { diagramType: "cycle", ...box };
}

export function layoutTimeline(doc: ConceptDoc): PositionedGraph {
  const nodes = new Map<string, PositionedNode>();
  // Order nodes by steps[].at (matching step.id to node id); unmatched nodes appended.
  const order: string[] = [];
  const seen = new Set<string>();
  if (doc.steps) {
    for (const s of [...doc.steps].sort((a, b) => a.at - b.at)) {
      if (doc.nodes.some((nn) => nn.id === s.id) && !seen.has(s.id)) {
        order.push(s.id);
        seen.add(s.id);
      }
    }
  }
  for (const nn of doc.nodes) if (!seen.has(nn.id)) order.push(nn.id);

  const colW = 270;
  doc.nodes.forEach((node) => {
    const idx = order.indexOf(node.id);
    const m = measureNode(node);
    nodes.set(node.id, {
      id: node.id,
      label: node.label,
      kind: defaultKind(node),
      ...(node.note ? { note: node.note } : {}),
      x: idx * colW,
      y: 0,
      w: m.w,
      h: m.h,
    });
  });
  const edges = routeEdges(doc, nodes);
  const groups = buildGroups(doc, nodes);
  const box = shiftAndBox([...nodes.values()], groups, edges);
  return { diagramType: "timeline", ...box };
}

export function layoutComparison(doc: ConceptDoc): PositionedGraph {
  const groups = doc.groups ?? [];
  const nodes = new Map<string, PositionedNode>();
  const colW = 300;
  const rowH = 100;
  // Assign each node to a column index by group; ungrouped nodes get their own middle column.
  const colOf = new Map<string, number>();
  groups.forEach((g, gi) => g.members.forEach((m) => colOf.set(m, gi)));
  let nextCol = groups.length;
  for (const nn of doc.nodes) if (!colOf.has(nn.id)) colOf.set(nn.id, nextCol);

  const counts = new Map<number, number>();
  for (const c of colOf.values()) counts.set(c, (counts.get(c) ?? 0) + 1);
  const idxInCol = new Map<number, number>();
  doc.nodes.forEach((node) => {
    const c = colOf.get(node.id)!;
    const i = idxInCol.get(c) ?? 0;
    idxInCol.set(c, i + 1);
    const total = counts.get(c)!;
    const m = measureNode(node);
    nodes.set(node.id, {
      id: node.id,
      label: node.label,
      kind: defaultKind(node),
      ...(node.note ? { note: node.note } : {}),
      x: c * colW,
      y: (i - (total - 1) / 2) * rowH,
      w: m.w,
      h: m.h,
    });
  });
  const edges = routeEdges(doc, nodes);
  const positionedGroups = buildGroups(doc, nodes);
  const box = shiftAndBox([...nodes.values()], positionedGroups, edges);
  return { diagramType: "comparison", ...box };
}

export function layoutRadial(doc: ConceptDoc): PositionedGraph {
  // BFS levels from the first node (treated as the center).
  const adj = new Map<string, string[]>();
  for (const nn of doc.nodes) adj.set(nn.id, []);
  for (const e of doc.edges) adj.get(e.from)?.push(e.to);
  const start = doc.nodes[0].id;
  const level = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of adj.get(u) ?? []) {
      if (!level.has(v)) {
        level.set(v, level.get(u)! + 1);
        queue.push(v);
      }
    }
  }
  // Nodes with no level (disconnected) get max+1.
  let maxLevel = 0;
  for (const l of level.values()) maxLevel = Math.max(maxLevel, l);
  for (const nn of doc.nodes) if (!level.has(nn.id)) level.set(nn.id, maxLevel + 1);

  const byLevel = new Map<number, string[]>();
  for (const nn of doc.nodes) {
    const l = level.get(nn.id)!;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(nn.id);
  }

  const nodes = new Map<string, PositionedNode>();
  // Ring radius grows with the busiest ring so labels never overlap.
  let maxPerRing = 1;
  for (const [l, ids] of byLevel) if (l > 0) maxPerRing = Math.max(maxPerRing, ids.length);
  const ringR = Math.max(170, maxPerRing * 80);
  for (const [l, ids] of byLevel) {
    if (l === 0) {
      const node = doc.nodes.find((nn) => nn.id === ids[0])!;
      const m = measureNode(node);
      nodes.set(node.id, {
        id: node.id,
        label: node.label,
        kind: defaultKind(node),
        ...(node.note ? { note: node.note } : {}),
        x: 0,
        y: 0,
        w: m.w,
        h: m.h,
      });
      continue;
    }
    ids.forEach((id, i) => {
      const node = doc.nodes.find((nn) => nn.id === id)!;
      const m = measureNode(node);
      const angle = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
      const r = ringR * l;
      nodes.set(id, {
        id,
        label: node.label,
        kind: defaultKind(node),
        ...(node.note ? { note: node.note } : {}),
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        w: m.w,
        h: m.h,
      });
    });
  }
  const edges = routeEdges(doc, nodes);
  const groups = buildGroups(doc, nodes);
  const box = shiftAndBox([...nodes.values()], groups, edges);
  return { diagramType: "mindmap", ...box };
}

/**
 * The public entry point. Pure function: same doc in -> same graph out.
 * Template-first: if the doc carries a known `template`, use that template's layout. Otherwise
 * fall back to the diagramType switch (the original generic engine — unchanged, keeps all
 * existing tests green).
 */
export function layout(doc: ConceptDoc): PositionedGraph {
  const tmpl = getTemplate(doc.template);
  if (tmpl) return tmpl.layout(doc);
  const type = resolveDiagramType(doc);
  switch (type) {
    case "hierarchy":
      return layoutDagre(doc, "TB");
    case "flow":
      return layoutDagre(doc, "LR");
    case "cycle":
      return layoutCircular(doc);
    case "timeline":
      return layoutTimeline(doc);
    case "comparison":
      return doc.groups && doc.groups.length > 0
        ? layoutComparison(doc)
        : layoutDagre(doc, "LR");
    case "mindmap":
      return layoutRadial(doc);
  }
}