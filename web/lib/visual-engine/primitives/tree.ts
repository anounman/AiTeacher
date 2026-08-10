/**
 * Tree primitive — the binary-tree fix.
 *
 * `layoutBinaryTree` positions a rooted binary tree by inorder-x (DFS) × column width and
 * depth-y, so a LEFT child is always strictly left of its parent and a RIGHT child strictly
 * right — the structure the old generic `hierarchy` layout flattened into a vertical stack.
 * `drawBranchEdge` renders the parent→child link as a sketched diagonal with the `left`/`right`
 * label near the parent. This is what makes "draw a binary tree" actually branch.
 *
 * The model emits only the semantic graph (root, nodes, left/right-labeled edges, optional
 * domain.root) — never coordinates. Layout is deterministic.
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
  pathFromPoints,
  registerEdgePrimitive,
  registerNodePrimitive,
  seedFrom,
} from "../render";
import type { Options } from "roughjs/bin/core.js";

interface ChildSlots {
  left?: string;
  right?: string;
}

function sideOf(label?: string): "left" | "right" | undefined {
  if (!label) return undefined;
  const l = label.toLowerCase();
  if (l === "left" || l === "l") return "left";
  if (l === "right" || l === "r") return "right";
  return undefined;
}

/**
 * Build the parent→{left,right} map from edges. Edges labeled left/right win; unlabeled edges
 * fill the left slot first, then right. Extra children beyond two are dropped from the tree
 * SHAPE (their edges are still routed as straight lines by routeEdges).
 */
function buildChildren(doc: ConceptDoc): Map<string, ChildSlots> {
  const children = new Map<string, ChildSlots>();
  const indegree = new Map<string, number>();
  for (const n of doc.nodes) indegree.set(n.id, 0);
  for (const e of doc.edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    const slots = children.get(e.from) ?? {};
    const side = sideOf(e.label);
    if (side === "left" && !slots.left) slots.left = e.to;
    else if (side === "right" && !slots.right) slots.right = e.to;
    else if (!slots.left) slots.left = e.to;
    else if (!slots.right) slots.right = e.to;
    // both slots filled -> extra child ignored for shape
    children.set(e.from, slots);
  }
  return children;
}

function pickRoot(doc: ConceptDoc, children: Map<string, ChildSlots>): string {
  const domain = doc.domain as { root?: unknown } | undefined;
  if (typeof domain?.root === "string" && doc.nodes.some((n) => n.id === domain.root)) {
    return domain.root;
  }
  // Node with no incoming edge and at least one child; else first node.
  const hasIncoming = new Set<string>();
  for (const e of doc.edges) hasIncoming.add(e.to);
  const candidates = doc.nodes.filter((n) => !hasIncoming.has(n.id));
  const withChildren = candidates.find((n) => children.has(n.id));
  return (withChildren ?? candidates[0] ?? doc.nodes[0]).id;
}

/**
 * Layout a binary tree: inorder-x by DFS × colW, y = depth × levelH.
 * Left child strictly left of parent; right child strictly right. Deterministic.
 */
export function layoutBinaryTree(doc: ConceptDoc): PositionedGraph {
  const children = buildChildren(doc);
  const root = pickRoot(doc, children);

  // Measure first so column/row spacing adapts to the widest/tallest node.
  const sizes = new Map<string, { w: number; h: number }>();
  let maxW = 110,
    maxH = 48;
  for (const n of doc.nodes) {
    const m = measureNode(n);
    sizes.set(n.id, m);
    maxW = Math.max(maxW, m.w);
    maxH = Math.max(maxH, m.h);
  }
  const colW = maxW + 36;
  const levelH = maxH + 70;

  // Inorder x-slot assignment via DFS from the root.
  const xSlot = new Map<string, number>();
  const depth = new Map<string, number>([[root, 0]]);
  let counter = 0;
  const visited = new Set<string>();
  const dfs = (id: string, d: number): void => {
    if (visited.has(id)) return;
    visited.add(id);
    depth.set(id, d);
    const slots = children.get(id);
    if (slots?.left) dfs(slots.left, d + 1);
    xSlot.set(id, counter++);
    if (slots?.right) dfs(slots.right, d + 1);
  };
  dfs(root, 0);

  // Disconnected nodes (no path from root): append below, in order.
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  for (const n of doc.nodes) {
    if (xSlot.has(n.id)) continue;
    depth.set(n.id, maxDepth + 1);
    xSlot.set(n.id, counter++);
  }

  const nodes = new Map<string, PositionedNode>();
  for (const n of doc.nodes) {
    const m = sizes.get(n.id)!;
    nodes.set(n.id, {
      id: n.id,
      label: n.label,
      kind: defaultKind(n),
      ...(n.note ? { note: n.note } : {}),
      x: (xSlot.get(n.id) ?? 0) * colW,
      y: (depth.get(n.id) ?? 0) * levelH,
      w: m.w,
      h: m.h,
      primitive: "treeNode",
    });
  }

  const edges: RoutedEdge[] = routeEdges(doc, nodes).map((e) => ({
    ...e,
    primitive: "branchEdge",
  }));

  // The graph bounds come from the nodes (shiftAndBox also nudges into the positive quadrant).
  const box = shiftAndBox([...nodes.values()], [], edges);
  return { diagramType: "hierarchy", ...box };
}

/** Draw a tree node — same sketched box/ellipse as the default, just registered under a name. */
function drawTreeNode(
  svg: SVGSVGElement,
  rc: RoughCanvas,
  n: PositionedNode,
  theme: RenderTheme,
): void {
  drawNode(svg, rc, n, theme);
}

/**
 * Draw a parent→child branch: a sketched diagonal through the routed points, an arrowhead at
 * the child, and the `left`/`right` label placed near the parent end (not the midpoint) so the
 * branching structure reads clearly.
 */
function drawBranchEdge(
  svg: SVGSVGElement,
  rc: RoughCanvas,
  e: RoutedEdge,
  theme: RenderTheme,
): void {
  const seed = seedFrom(`${e.from}->${e.to}`) || 1;
  const opts: Options = {
    seed,
    roughness: 1.5,
    stroke: theme.ink,
    strokeWidth: 2,
  };
  svg.appendChild(rc.path(pathFromPoints(e.points), opts));

  const last = e.points[e.points.length - 1];
  const prev = e.points[e.points.length - 2] ?? e.points[0];
  drawArrowhead(svg, rc, last, prev, theme, seed);

  if (e.label) {
    // Place the label ~35% from the parent end, with a backing rect for legibility.
    const a = e.points[0];
    const b = last;
    const t = 0.35;
    const mid = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - 6 };
    const doc = svg.ownerDocument;
    const label = makeSvgEl(doc, "text", {
      x: String(mid.x),
      y: String(mid.y),
      "text-anchor": "middle",
      "font-family": theme.font,
      "font-size": "15",
      fill: theme.ink,
    });
    label.textContent = e.label;
    const w = Math.max(30, e.label.length * 8 + 10);
    const back = makeSvgEl(doc, "rect", {
      x: String(mid.x - w / 2),
      y: String(mid.y - 16),
      width: String(w),
      height: "18",
      rx: "6",
      fill: theme.labelBg,
      opacity: "0.92",
    });
    svg.appendChild(back);
    svg.appendChild(label);
  }
}

// Self-register on import.
registerNodePrimitive("treeNode", drawTreeNode);
registerEdgePrimitive("branchEdge", drawBranchEdge);