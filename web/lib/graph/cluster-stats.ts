// Pure per-cluster aggregate stats for the cluster-card overview. No React,
// no DB. All three helpers are deterministic and side-effect-free.

import type { Cluster, GraphConcept, GraphEdge } from "@/lib/graph/clusters";
import type { Band } from "@/lib/mastery/model";

export interface ClusterMastery {
  strong: number;
  learning: number;
  slipping: number;
  untested: number;
  unknown: number;
}

function emptyMastery(): ClusterMastery {
  return { strong: 0, learning: 0, slipping: 0, untested: 0, unknown: 0 };
}

// Per-cluster mastery band counts. Every cluster id present in `clusters`
// (including the synthetic "isolated" cluster) is initialized to zeros so
// the overview always has a bar to render even for empty buckets. Concepts
// whose `c2cluster` lookup misses are skipped (defensive — the page builds
// `c2cluster` from the same `clusters`).
export function masteryByCluster(
  clusters: Cluster[],
  concepts: GraphConcept[],
  c2cluster: Map<string, string>,
): Map<string, ClusterMastery> {
  const out = new Map<string, ClusterMastery>();
  for (const cl of clusters) out.set(cl.id, emptyMastery());
  for (const c of concepts) {
    const cid = c2cluster.get(c.id);
    if (!cid) continue;
    const m = out.get(cid);
    if (!m) continue;
    const band: Band = c.band ?? "unknown";
    m[band] += 1;
  }
  return out;
}

// Per-cluster external-link counts. An edge contributes 1 to a cluster's
// count when EXACTLY ONE of its endpoints maps to that cluster (an
// inter-cluster edge). So an edge crossing from cluster A to cluster B counts
// 1 toward A and 1 toward B; an edge with both endpoints in A counts 0 toward
// A; an edge with one endpoint in A and the other unmapped counts 1 toward A.
// Every cluster id is initialized to 0.
export function externalLinkCountByCluster(
  clusters: Cluster[],
  edges: GraphEdge[],
  c2cluster: Map<string, string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const cl of clusters) out.set(cl.id, 0);
  for (const e of edges) {
    if (e.source === e.target) continue;
    const cs = c2cluster.get(e.source);
    const ct = c2cluster.get(e.target);
    if (cs === ct) continue; // intra-cluster (both same cluster, or both unmapped)
    if (cs !== undefined) out.set(cs, (out.get(cs) ?? 0) + 1);
    if (ct !== undefined) out.set(ct, (out.get(ct) ?? 0) + 1);
  }
  return out;
}

// The `n` highest-degree member labels of a cluster. Degree ties resolve to
// ascending label (deterministic). Uses `cluster.conceptIds` for membership,
// `degreeMap` for ranking, and `labelById` for display. Returns up to `n`
// labels (fewer if the cluster is smaller).
export function representativeConcepts(
  cluster: Cluster,
  degreeMap: Map<string, number>,
  labelById: Map<string, string>,
  n = 3,
): string[] {
  const sorted = [...cluster.conceptIds].sort((a, b) => {
    const da = degreeMap.get(a) ?? 0;
    const db = degreeMap.get(b) ?? 0;
    if (db !== da) return db - da; // higher degree first
    return (labelById.get(a) ?? a).localeCompare(labelById.get(b) ?? b); // tie → ascending label
  });
  return sorted
    .slice(0, n)
    .map((id) => labelById.get(id) ?? id);
}