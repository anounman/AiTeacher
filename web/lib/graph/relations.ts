// Pure relation helpers for the concept graph drill-down: the hierarchical /
// peer split, confidence-scored edge opacity, and the default edge filter
// that hides the noisy inferred-similarity + ambiguous edges. No React, no
// DB, no DOM — importable by a throwaway validation script.

import type { GraphEdge } from "@/lib/graph/clusters";

// The subset of relations that define the ranking backbone of the graph.
// Peer relations (example_of, contrasts_with, applies_to,
// semantically_similar_to) are NOT members — they render as faded secondary
// edges and must not influence placement.
export const HIERARCHICAL = new Set(["prerequisite_of", "part_of", "generalizes"]);

// All peer relations (everything not hierarchical). Kept for completeness /
// future styling; the renderer treats "not hierarchical" as peer.
export const PEER = new Set([
  "example_of",
  "contrasts_with",
  "applies_to",
  "semantically_similar_to",
]);

// confidence_score → stroke opacity (AMBIGUOUS faint, EXTRACTED strong). A null
// score (older rows) gets a mid-faint fallback.
export function edgeOpacity(score: number | null): number {
  if (score == null) return 0.4;
  return Math.max(0.18, Math.min(0.9, 0.18 + score * 0.72));
}

export interface FilterOpts {
  showSemSim: boolean; // reveal `semantically_similar_to` edges
  showAmbiguous: boolean; // reveal `AMBIGUOUS`-confidence edges
}

// The default filter that declutters the drill-down: drop
// `semantically_similar_to` (the 423 inferred cosine edges in Maths — 28% of
// all edges — are the main thing crisscrossing the graph) and drop
// `AMBIGUOUS`-confidence edges. Both are opt-in via the toggles.
export function filterEdges(edges: GraphEdge[], opts: FilterOpts): GraphEdge[] {
  return edges.filter((e) => {
    if (e.relation === "semantically_similar_to" && !opts.showSemSim) return false;
    if (e.confidence === "AMBIGUOUS" && !opts.showAmbiguous) return false;
    return true;
  });
}

// Whether an edge is hidden under the default filter (UI uses this to count
// "N of M edges shown" without re-deriving the rule).
export function isEdgeHiddenByDefault(e: GraphEdge): boolean {
  return e.relation === "semantically_similar_to" || e.confidence === "AMBIGUOUS";
}