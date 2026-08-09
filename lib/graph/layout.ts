import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceCenter,
  type SimulationNodeDatum,
} from "d3-force";

export interface LayoutNode {
  id: string;
  radius: number;
}

export interface LayoutLink {
  source: string;
  target: string;
}

// Deterministic-ish initial position: spread nodes on a circle around the
// center, angle derived from a stable string hash of the id. Same data → same
// start → similar settled layout across runs (d3-force's internal jitter is
// acceptable; cluster membership — the thing that must be stable — is fixed by
// clusters.ts, not here).
function hashAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (((h % 1000) + 1000) % 1000) / 1000; // 0..1
}

// Synchronously compute node positions via d3-force. Runs a fixed number of
// ticks then stops, returning a Map of id → {x,y}. Caller maps these onto
// @xyflow/react Node positions.
export function layoutNodes(
  nodes: LayoutNode[],
  links: LayoutLink[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;
  if (nodes.length === 1) {
    out.set(nodes[0].id, { x: width / 2, y: height / 2 });
    return out;
  }

  // Density control: scale the effective canvas with node count so dense graphs
  // get proportionally more room (lower density after @xyflow's fitView zooms
  // to fit) while small graphs stay compact. spread = sqrt(n/25), clamped so
  // tiny graphs aren't over-spread and huge ones don't run away. fitView
  // normalizes the absolute size away, so what matters is the gap-to-node-size
  // ratio, which the larger canvas + stronger forces below preserve.
  const spread = Math.max(1, Math.min(3, Math.sqrt(nodes.length / 25)));
  const w = width * spread;
  const h = height * spread;
  const cx = w / 2;
  const cy = h / 2;
  const radius = (Math.min(w, h) / 2) * 0.85;

  type SimNode = SimulationNodeDatum & { id: string; r: number };
  const simNodes: SimNode[] = nodes.map((n, i) => {
    const a = (hashAngle(n.id) + i / nodes.length) * Math.PI * 2;
    return { id: n.id, r: n.radius, x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  });
  const idIndex = new Map(simNodes.map((n, i) => [n.id, i]));

  // Resolve links to node indices (d3-force replaces source/target with node
  // refs when given an id accessor; we pass objects with id fields + the accessor).
  const simLinks = links
    .filter((l) => idIndex.has(l.source) && idIndex.has(l.target) && l.source !== l.target)
    .map((l) => ({ source: l.source, target: l.target }));

  // Force tuning (measured against the Maths graph: 41 overview clusters, up to
  // 80 concept nodes per drill-down): charge -600 gives non-neighbors breathing
  // room, link distance 150 + strength 0.4 keeps connected nodes related without
  // collapsing the component, collide r+14 guarantees a 28px min gap (no overlap),
  // forceCenter re-centers the settled cloud. forceCenter only translates the
  // center of mass — it does not collapse nodes onto each other.
  const simulation = forceSimulation<SimNode>(simNodes)
    .force("charge", forceManyBody().strength(-600))
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((d) => d.id)
        .distance(150)
        .strength(0.4),
    )
    .force("collide", forceCollide<SimNode>().radius((d) => d.r + 14))
    .force("center", forceCenter(cx, cy));

  // Synchronous settle: more ticks for larger graphs so they reach equilibrium.
  // Bounded so small graphs settle fast. Run fixed ticks, then stop.
  const ticks = Math.min(700, 250 + nodes.length * 5);
  for (let i = 0; i < ticks; i++) simulation.tick();
  simulation.stop();

  for (const n of simNodes) out.set(n.id, { x: n.x ?? cx, y: n.y ?? cy });
  return out;
}