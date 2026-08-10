import type { VisualAction } from "./visual-schema";

// Convert a validated draw_architecture action into mathwriter [DRAW] markup,
// so director scenes are drawn in the same hand as the rest of the board
// instead of a styled SVG card (TODO 2c.14). Layout is deterministic layered
// left-to-right / top-to-bottom — the model only ever chose nodes and edges.

type ArchitectureAction = Extract<VisualAction, { action: "draw_architecture" }>;

// Pixel geometry in DRAW canvas units (auto-cropped by the renderer).
const CHAR_W = 11; // ≈ width of one TEXT glyph at scale 0.55
const NODE_H = 36;
const NODE_PAD = 22;
const LAYER_GAP = 64;
const CROSS_GAP = 26;

function ranksOf(action: ArchitectureAction): Map<string, number> {
  const ids = new Set(action.nodes.map((n) => n.id));
  const incoming = new Map(action.nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(action.nodes.map((n) => [n.id, [] as string[]]));
  for (const edge of action.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const ranks = new Map(action.nodes.map((n) => [n.id, 0]));
  const queue = action.nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const target of outgoing.get(id) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(id) ?? 0) + 1));
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  // Cycles still lay out: unvisited nodes go into consecutive extra layers.
  let next = Math.max(0, ...ranks.values());
  for (const node of action.nodes) if (!seen.has(node.id)) ranks.set(node.id, next++);
  return ranks;
}

// The DRAW TEXT primitive delimits with double quotes and has no escape.
function textSafe(label: string): string {
  return label.replace(/"/g, "'").replace(/\s+/g, " ").trim().slice(0, 28);
}

export function drawMarkupFromArchitecture(action: ArchitectureAction): string {
  const ranks = ranksOf(action);
  const layers = new Map<number, ArchitectureAction["nodes"]>();
  for (const node of action.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    layers.set(rank, [...(layers.get(rank) ?? []), node]);
  }
  const ordered = [...layers.entries()].sort((a, b) => a[0] - b[0]).map(([, nodes]) => nodes);
  const horizontal = action.direction !== "top_to_bottom";

  // Column (or row) extents come from the widest label in each layer.
  const widthOf = (label: string) => Math.max(70, textSafe(label).length * CHAR_W + NODE_PAD);
  const layerWidths = ordered.map((nodes) => Math.max(...nodes.map((n) => widthOf(n.label))));
  const maxPerLayer = Math.max(1, ...ordered.map((nodes) => nodes.length));
  const crossExtent = maxPerLayer * NODE_H + (maxPerLayer - 1) * CROSS_GAP;

  const pos = new Map<string, { x: number; y: number; w: number }>();
  let along = 10;
  ordered.forEach((nodes, layerIndex) => {
    const w = layerWidths[layerIndex]!;
    const used = nodes.length * NODE_H + (nodes.length - 1) * CROSS_GAP;
    nodes.forEach((node, index) => {
      const cross = (crossExtent - used) / 2 + index * (NODE_H + CROSS_GAP) + 10;
      pos.set(node.id, horizontal ? { x: along, y: cross, w } : { x: cross, y: along, w });
    });
    along += (horizontal ? w : NODE_H) + LAYER_GAP;
  });

  const lines: string[] = [];
  // Edges first so boxes overdraw the arrow tails cleanly.
  for (const edge of action.edges) {
    const from = pos.get(edge.from);
    const to = pos.get(edge.to);
    if (!from || !to) continue;
    const x1 = horizontal ? from.x + from.w : from.x + from.w / 2;
    const y1 = horizontal ? from.y + NODE_H / 2 : from.y + NODE_H;
    const x2 = horizontal ? to.x : to.x + to.w / 2;
    const y2 = horizontal ? to.y + NODE_H / 2 : to.y;
    lines.push(`ARROW ${Math.round(x1)},${Math.round(y1)} ${Math.round(x2)},${Math.round(y2)} head=7`);
    // A label needs room: on a short arrow it just collides with the boxes.
    if (edge.label && Math.hypot(x2 - x1, y2 - y1) >= textSafe(edge.label).length * 8 + 30) {
      lines.push(
        `TEXT ${Math.round((x1 + x2) / 2)},${Math.round((y1 + y2) / 2 - 12)} "${textSafe(edge.label)}" center=true scale=0.4`,
      );
    }
  }
  for (const node of action.nodes) {
    const p = pos.get(node.id)!;
    lines.push(`RECT ${Math.round(p.x)},${Math.round(p.y)} ${Math.round(p.w)},${NODE_H}`);
    lines.push(
      `TEXT ${Math.round(p.x + p.w / 2)},${Math.round(p.y + NODE_H / 2)} "${textSafe(node.label)}" center=true scale=0.55`,
    );
  }
  return `[DRAW]\n${lines.join("\n")}\n[/DRAW]`;
}
