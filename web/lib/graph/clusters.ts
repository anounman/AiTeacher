// Client-side topic-community detection for the concept graph (SP2).
// Deterministic label propagation: same input always yields the same cluster
// assignment, so the overview is stable across reloads as long as the graph
// data is unchanged. Pure, no React, no DB.

import type { Band } from "@/lib/mastery/model";

export interface GraphConcept {
  id: string;
  label: string;
  slug: string;
  description: string | null;
  sourceCount: number;
  band?: Band;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  score: number | null;
  weight?: number; // overview-only: count of concept edges crossing this cluster pair
}

export interface GraphData {
  concepts: GraphConcept[];
  edges: GraphEdge[];
  materials: { materialId: string; title: string; status: string; conceptCount: number; error: string | null }[];
}

export interface Cluster {
  id: string;
  name: string;
  conceptCount: number;
  conceptIds: string[];
}

// Undirected degree (number of incident edges) for each concept. Used both for
// label-propagation tie-breaking and for sizing nodes / naming clusters.
function degreeMap(concepts: GraphConcept[], edges: GraphEdge[]): Map<string, number> {
  const deg = new Map<string, number>();
  for (const c of concepts) deg.set(c.id, 0);
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!deg.has(e.source) || !deg.has(e.target)) continue;
    deg.set(e.source, deg.get(e.source)! + 1);
    deg.set(e.target, deg.get(e.target)! + 1);
  }
  return deg;
}

// Heuristic cluster name: the 2 highest-degree member labels joined with " · ".
// Ties in degree broken by ascending label for determinism.
function clusterName(memberIds: string[], labelById: Map<string, string>, deg: Map<string, number>): string {
  const sorted = [...memberIds].sort((a, b) => {
    const da = deg.get(a) ?? 0;
    const db = deg.get(b) ?? 0;
    if (db !== da) return db - da;
    return (labelById.get(a) ?? a).localeCompare(labelById.get(b) ?? b);
  });
  const top = sorted.slice(0, 2).map((id) => labelById.get(id) ?? id);
  return top.join(" · ");
}

const ITERATIONS = 12;

// Detect topic communities via label propagation. Concepts with no edges
// (degree 0) are merged into a single "isolated" cluster so the overview stays
// tidy (they aren't a topic community). Deterministic: concepts are processed
// in sorted-id order each iteration, and ties resolve to the lexicographically
// smallest label.
export function detectCommunities(concepts: GraphConcept[], edges: GraphEdge[]): Cluster[] {
  if (concepts.length === 0) return [];

  const ids = concepts.map((c) => c.id).sort();
  const labelById = new Map(concepts.map((c) => [c.id, c.label]));
  const deg = degreeMap(concepts, edges);

  // Undirected adjacency (skip self-loops + unknown endpoints).
  const adj = new Map<string, Set<string>>();
  for (const id of ids) adj.set(id, new Set());
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }

  // Initialize each node's label to its own id (deterministic seed).
  const label = new Map<string, string>();
  for (const id of ids) label.set(id, id);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const id of ids) {
      const neighbors = adj.get(id)!;
      if (neighbors.size === 0) continue; // isolated: keep own label
      const counts = new Map<string, number>();
      for (const n of neighbors) {
        const nl = label.get(n)!;
        counts.set(nl, (counts.get(nl) ?? 0) + 1);
      }
      // Pick the most frequent neighbor label; tie → lexicographically smallest.
      let best = "";
      let bestCount = -1;
      for (const [l, count] of counts) {
        if (count > bestCount || (count === bestCount && l < best)) {
          best = l;
          bestCount = count;
        }
      }
      if (best) label.set(id, best);
    }
  }

  // Group by final label.
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const l = label.get(id)!;
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l)!.push(id);
  }

  const clusters: Cluster[] = [];
  const isolated: string[] = [];
  for (const [l, members] of groups) {
    const memberDeg = members.map((m) => deg.get(m) ?? 0);
    const isConnected = memberDeg.some((d) => d > 0);
    if (!isConnected) {
      isolated.push(...members);
      continue;
    }
    clusters.push({
      id: l,
      name: clusterName(members, labelById, deg),
      conceptCount: members.length,
      conceptIds: members,
    });
  }
  if (isolated.length > 0) {
    clusters.push({
      id: "isolated",
      name: "Isolated concepts",
      conceptCount: isolated.length,
      conceptIds: isolated,
    });
  }

  // Stable order: by conceptCount desc, then by name asc.
  clusters.sort((a, b) => b.conceptCount - a.conceptCount || a.name.localeCompare(b.name));
  return clusters;
}

// conceptId → clusterId lookup, built once per render in the page.
export function conceptClusterMap(clusters: Cluster[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const cl of clusters) for (const id of cl.conceptIds) m.set(id, cl.id);
  return m;
}