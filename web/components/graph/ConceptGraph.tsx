"use client";

import { useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutNodes, type LayoutNode, type LayoutLink } from "@/lib/graph/layout";
import type { GraphConcept, GraphEdge, Cluster } from "@/lib/graph/clusters";
import type { Band } from "@/lib/mastery/model";

// --- visual encoding constants (monochrome Graph Paper tokens) ---
const CANVAS_W = 900;
const CANVAS_H = 620;

function conceptRadius(degree: number): number {
  return Math.max(16, Math.min(40, 16 + degree * 1.6));
}
function clusterRadius(conceptCount: number): number {
  return Math.max(26, Math.min(70, 26 + conceptCount * 1.4));
}
// confidence_score → stroke opacity (AMBIGUOUS faint, EXTRACTED strong).
function edgeOpacity(score: number | null): number {
  if (score == null) return 0.4;
  return Math.max(0.18, Math.min(0.9, 0.18 + score * 0.72));
}

// --- custom node components ---

type ConceptNodeData = {
  label: string;
  degree: number;
  sourceCount: number;
  band: Band;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
};
type ConceptRFNode = Node<ConceptNodeData, "concept">;

function bandBorder(band: Band): string {
  switch (band) {
    case "slipping": return "border-rule";
    case "strong": return "border-feynman";
    case "learning": return "border-ink";
    default: return "border-ink-3"; // untested + unknown
  }
}

function ConceptNode({ data }: NodeProps<ConceptRFNode>) {
  const filled = data.sourceCount >= 2;
  const base = `flex items-center justify-center rounded-full text-center transition-opacity ${
    data.dimmed ? "opacity-20" : "opacity-100"
  }`;
  const box = filled
    ? "bg-ink text-paper border-2"
    : "bg-paper text-ink-3 border-2";
  const bandBorderClass = bandBorder(data.band);
  const border = (data.selected || data.hovered)
    ? "border-rule border-[3px]"
    : bandBorderClass;
  const dim = data.band === "unknown" ? "opacity-40" : "";
  // size via inline style so it scales with degree
  const r = conceptRadius(data.degree);
  return (
    <div className={base} style={{ width: r * 2, height: r * 2 }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className={`${box} ${border} ${dim} mono rounded-full px-2 py-1 text-[10px] leading-tight`} style={{ maxWidth: r * 2.4 }}>
        {data.label}
      </div>
    </div>
  );
}

type ClusterNodeData = {
  label: string;
  conceptCount: number;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
};
type ClusterRFNode = Node<ClusterNodeData, "cluster">;

function ClusterNode({ data }: NodeProps<ClusterRFNode>) {
  const r = clusterRadius(data.conceptCount);
  return (
    <div className={`transition-opacity ${data.dimmed ? "opacity-30" : "opacity-100"}`} style={{ width: r * 2, height: r * 2 }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div
        className={`mono flex h-full w-full flex-col items-center justify-center rounded-[3px] border-2 bg-paper px-2 text-center ${
          (data.selected || data.hovered) ? "border-rule" : "border-line"
        }`}
      >
        <div className="text-[11px] leading-tight text-ink">{data.label}</div>
        <div className="mt-0.5 text-[9px] text-ink-3">{data.conceptCount} concepts</div>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { concept: ConceptNode, cluster: ClusterNode };

interface ConceptGraphProps {
  kind: "overview" | "concept";
  clusters: Cluster[];
  concepts: GraphConcept[];
  edges: GraphEdge[];
  selectedId: string | null;
  onNodeClick: (id: string) => void;
}

export function ConceptGraph({
  kind,
  clusters,
  concepts,
  edges,
  selectedId,
  onNodeClick,
}: ConceptGraphProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Active node ids + per-node degree (undirected) for the current view.
  const { nodeIds, degreeById, labelById, sourceCountById, bandById } = useMemo(() => {
    if (kind === "overview") {
      const ids = clusters.map((c) => c.id);
      const deg = new Map<string, number>();
      const lbl = new Map<string, string>(clusters.map((c) => [c.id, c.name]));
      const sc = new Map<string, number>();
      const band = new Map<string, Band>();
      // inter-cluster edge weight = degree between clusters
      for (const e of edges) {
        // edges here are inter-cluster; count per cluster node
        deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
        deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
      }
      return { nodeIds: ids, degreeById: deg, labelById: lbl, sourceCountById: sc, bandById: band };
    }
    const ids = concepts.map((c) => c.id);
    const deg = new Map<string, number>(ids.map((id) => [id, 0]));
    const lbl = new Map<string, string>(concepts.map((c) => [c.id, c.label]));
    const sc = new Map<string, number>(concepts.map((c) => [c.id, c.sourceCount]));
    const band = new Map<string, Band>(concepts.map((c) => [c.id, c.band ?? "unknown"]));
    for (const e of edges) {
      if (e.source === e.target) continue;
      if (!deg.has(e.source) || !deg.has(e.target)) continue;
      deg.set(e.source, deg.get(e.source)! + 1);
      deg.set(e.target, deg.get(e.target)! + 1);
    }
    return { nodeIds: ids, degreeById: deg, labelById: lbl, sourceCountById: sc, bandById: band };
  }, [kind, clusters, concepts, edges]);

  // Layout positions for the active nodes.
  const positions = useMemo(() => {
    const ln: LayoutNode[] = nodeIds.map((id) => ({
      id,
      radius:
        kind === "overview"
          ? clusterRadius(clusters.find((c) => c.id === id)?.conceptCount ?? 1)
          : conceptRadius(degreeById.get(id) ?? 0),
    }));
    const ll: LayoutLink[] = edges
      .filter((e) => nodeIds.includes(e.source) && nodeIds.includes(e.target) && e.source !== e.target)
      .map((e) => ({ source: e.source, target: e.target }));
    return layoutNodes(ln, ll, CANVAS_W, CANVAS_H);
  }, [nodeIds, edges, kind, clusters, degreeById]);

  // Neighbor set for hover-dim.
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const id of nodeIds) m.set(id, new Set());
    for (const e of edges) {
      if (e.source === e.target) continue;
      if (!m.has(e.source) || !m.has(e.target)) continue;
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [nodeIds, edges]);

  const focusId = hoveredId ?? selectedId;
  const focusNeighbors = focusId ? neighbors.get(focusId) ?? null : null;

  // Build @xyflow nodes + edges with encoding + hover-dim applied.
  const { rfNodes, rfEdges } = useMemo(() => {
    const rfNodes: Node[] = nodeIds.map((id) => {
      const pos = positions.get(id) ?? { x: CANVAS_W / 2, y: CANVAS_H / 2 };
      const selected = id === selectedId;
      const hovered = id === hoveredId;
      const dimmed = !!focusId && id !== focusId && !(focusNeighbors?.has(id) ?? false);
      if (kind === "overview") {
        const cl = clusters.find((c) => c.id === id);
        return {
          id,
          type: "cluster",
          position: pos,
          data: { label: cl?.name ?? id, conceptCount: cl?.conceptCount ?? 0, selected, hovered, dimmed },
        } satisfies Node<ClusterNodeData, "cluster">;
      }
      return {
        id,
        type: "concept",
        position: pos,
        data: {
          label: labelById.get(id) ?? id,
          degree: degreeById.get(id) ?? 0,
          sourceCount: sourceCountById.get(id) ?? 0,
          band: bandById.get(id) ?? "unknown",
          selected,
          hovered,
          dimmed,
        },
      } satisfies Node<ConceptNodeData, "concept">;
    });

    const rfEdges: Edge[] = edges
      .filter((e) => nodeIds.includes(e.source) && nodeIds.includes(e.target) && e.source !== e.target)
      .map((e) => {
        const dimmed = !!focusId && e.source !== focusId && e.target !== focusId;
        const id = `${e.source}->${e.target}->${e.relation}`;
        const isHoveredEdge = id === hoveredEdgeId;
        if (kind === "overview") {
          // Aggregated inter-cluster edge: stroke width + opacity scale with the
          // count of concept edges crossing this cluster pair (spec: neutral ink-3).
          // No dash — aggregation loses per-edge relation meaning.
          const w = e.weight ?? 1;
          const sw = 1 + Math.min(w, 6) * 0.6;
          const op = Math.min(0.8, 0.25 + w * 0.08) * (dimmed ? 0.25 : 1);
          return {
            id,
            source: e.source,
            target: e.target,
            style: { stroke: "var(--ink-3)", strokeWidth: sw, strokeOpacity: op },
            markerEnd: { type: MarkerType.ArrowClosed, color: "var(--ink-3)" },
            label: isHoveredEdge ? `${w} links` : undefined,
            labelStyle: { fontFamily: "monospace", fontSize: 10, fill: "var(--ink-2)" },
            labelBgStyle: { fill: "var(--paper)" },
            labelBgPadding: [2, 1] as [number, number],
          };
        }
        const dashed = e.relation === "semantically_similar_to";
        const op = edgeOpacity(e.score) * (dimmed ? 0.25 : 1);
        return {
          id,
          source: e.source,
          target: e.target,
          style: { stroke: "var(--ink-2)", strokeWidth: 1.5, strokeOpacity: op, strokeDasharray: dashed ? "4 3" : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--ink-2)" },
          // Relation label shown only on the hovered edge (spec: small .mono tag
          // near the midpoint on hover). @xyflow renders edge.label as a pill.
          label: isHoveredEdge ? e.relation : undefined,
          labelStyle: { fontFamily: "monospace", fontSize: 10, fill: "var(--ink-2)" },
          labelBgStyle: { fill: "var(--paper)" },
          labelBgPadding: [2, 1] as [number, number],
        };
      });

    return { rfNodes, rfEdges };
  }, [nodeIds, positions, kind, clusters, labelById, degreeById, sourceCountById, bandById, edges, selectedId, focusId, focusNeighbors, hoveredId, hoveredEdgeId]);

  const onNodeMouseEnter = useCallback<NodeMouseHandler>((_, node) => setHoveredId(node.id), []);
  const onNodeMouseLeave = useCallback<NodeMouseHandler>(() => setHoveredId(null), []);
  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => onNodeClick(node.id), [onNodeClick]);

  if (nodeIds.length === 0) {
    return (
      <div className="mono flex h-[620px] items-center justify-center rounded-[3px] border border-line bg-paper-2 text-[12px] text-ink-3">
        nothing to show
      </div>
    );
  }

  return (
    <div className="h-[620px] w-full rounded-[3px] border border-line bg-paper-2">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="var(--line)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}