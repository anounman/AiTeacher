// Pure learning-path computation for the concept graph: per-concept status over
// the prerequisite_of DAG, coverage metrics, and the per-cluster frontier.
// No React, no DB, no DOM — importable by a throwaway test. All inputs are
// already returned by GET /api/concepts (per-concept band + edges with relation).

import type { Band } from "@/lib/mastery/model";
import type { Cluster } from "@/lib/graph/clusters";

export type ConceptStatus = "locked" | "ready" | "in_progress" | "mastered";

// A concept's status:
//   mastered    — band "strong"
//   in_progress — band "learning" or "slipping" (active study overrides "ready")
//   ready       — not mastered/in-progress AND every transitive prerequisite_of
//                 ancestor is mastered (strict, transitive gating)
//   locked      — otherwise (some ancestor isn't mastered)
// prerequisite_of direction: edge source->target means source is needed for
// target, so C's prerequisites are the sources of prerequisite_of edges into
// C. part_of / generalizes do NOT gate (containment/abstraction, not needed-
// before). Self-loops are ignored. Cycles: an unmastered cycle's members stay
// locked (each member's ancestor set includes the cycle), unlocking together.
export function computeStatuses(
  concepts: { id: string; band?: Band }[],
  edges: { source: string; target: string; relation: string }[],
): Map<string, ConceptStatus> {
  // Prereq adjacency: for each concept C, the set of direct prerequisites
  // (sources of prerequisite_of edges into C). Self-loops skipped.
  const prereqs = new Map<string, Set<string>>();
  for (const c of concepts) prereqs.set(c.id, new Set());
  for (const e of edges) {
    if (e.relation !== "prerequisite_of") continue;
    if (e.source === e.target) continue;
    if (!prereqs.has(e.target) || !prereqs.has(e.source)) continue;
    prereqs.get(e.target)!.add(e.source);
  }

  // Mastered set (band strong). Used as the gating gate.
  const mastered = new Set<string>();
  for (const c of concepts) {
    if (c.band === "strong") mastered.add(c.id);
  }

  const status = new Map<string, ConceptStatus>();
  const memo = new Map<string, ConceptStatus>();

  // Are all transitive prereq ancestors of C mastered? visited guards cycles.
  function ancestorsMastered(id: string, visited: Set<string>): boolean {
    if (memo.has(id)) return memo.get(id) === "ready";
    if (visited.has(id)) {
      // Cycle: this revisit is only reachable through mastered nodes — each
      // `p` passed the `mastered.has(p)` check before recursing into
      // ancestorsMastered. So a cycle node is mastered by construction → its
      // ancestors are satisfied → return true (the external dependent is ready).
      return mastered.has(id);
    }
    visited.add(id);
    for (const p of prereqs.get(id) ?? []) {
      if (!mastered.has(p)) {
        // p not mastered — but p might still be "ready"? No: ready requires
        // mastered ancestors, and p isn't mastered, so p is not a satisfied
        // prerequisite. Strict gating: not satisfied.
        visited.delete(id);
        memo.set(id, "locked");
        return false;
      }
      // p is mastered; its own ancestors must also be mastered (transitive).
      if (!ancestorsMastered(p, visited)) {
        visited.delete(id);
        memo.set(id, "locked");
        return false;
      }
    }
    visited.delete(id);
    memo.set(id, "ready");
    return true;
  }

  for (const c of concepts) {
    if (c.band === "strong") {
      status.set(c.id, "mastered");
      continue;
    }
    if (c.band === "learning" || c.band === "slipping") {
      status.set(c.id, "in_progress");
      continue;
    }
    // untested / unknown / undefined → check prereqs (strict, transitive).
    const ok = ancestorsMastered(c.id, new Set());
    status.set(c.id, ok ? "ready" : "locked");
  }
  return status;
}

export interface Coverage {
  total: number;
  mastered: number;
  ready: number;
  inProgress: number;
  locked: number;
  percent: number; // 0..100; 0 when total === 0
}

export function computeCoverage(statuses: Map<string, ConceptStatus>): Coverage {
  let mastered = 0, ready = 0, inProgress = 0, locked = 0;
  for (const st of statuses.values()) {
    if (st === "mastered") mastered++;
    else if (st === "ready") ready++;
    else if (st === "in_progress") inProgress++;
    else locked++;
  }
  const total = mastered + ready + inProgress + locked;
  return {
    total, mastered, ready, inProgress, locked,
    percent: total === 0 ? 0 : Math.round((mastered / total) * 100),
  };
}

export interface FrontierItem {
  conceptId: string;
  label: string;
  dependents: number; // out-degree in prerequisite_of
}

export interface ClusterStatus {
  clusterId: string;
  coverage: Coverage;
  complete: boolean; // 0 ready/locked/inProgress
  blocked: boolean;  // locked > 0 AND ready === 0
  startHere: string | null;
  startHereLabel: string | null;
  frontier: FrontierItem[]; // ready concepts, ranked
}

// Per-cluster coverage, flags, and ranked frontier. Ranking within a cluster:
// prerequisite_of out-degree desc (most-foundational first), tiebreak by total
// degree desc, then label asc. The top ready concept is the cluster's "start
// here" entrypoint.
export function computeClusterStatuses(
  clusters: Cluster[],
  statuses: Map<string, ConceptStatus>,
  edges: { source: string; target: string; relation: string }[],
  labelById: Map<string, string>,
): ClusterStatus[] {
  // prerequisite_of out-degree and total degree per concept.
  const prereqOut = new Map<string, number>();
  const totalDeg = new Map<string, number>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    totalDeg.set(e.source, (totalDeg.get(e.source) ?? 0) + 1);
    totalDeg.set(e.target, (totalDeg.get(e.target) ?? 0) + 1);
    if (e.relation === "prerequisite_of") {
      prereqOut.set(e.source, (prereqOut.get(e.source) ?? 0) + 1);
    }
  }

  return clusters.map((cl) => {
    const clusterEntries = cl.conceptIds
      .map((id) => [id, statuses.get(id)] as const)
      .filter(([, s]) => s != null) as [string, ConceptStatus][];
    const coverage = computeCoverage(new Map(clusterEntries));

    const readyIds = cl.conceptIds.filter((id) => statuses.get(id) === "ready");
    const frontier: FrontierItem[] = readyIds
      .map((id) => ({
        conceptId: id,
        label: labelById.get(id) ?? id,
        dependents: prereqOut.get(id) ?? 0,
      }))
      .sort((a, b) => {
        if (b.dependents !== a.dependents) return b.dependents - a.dependents;
        const da = totalDeg.get(a.conceptId) ?? 0;
        const db = totalDeg.get(b.conceptId) ?? 0;
        if (db !== da) return db - da;
        return a.label.localeCompare(b.label);
      });

    return {
      clusterId: cl.id,
      coverage,
      complete: coverage.ready === 0 && coverage.locked === 0 && coverage.inProgress === 0,
      blocked: coverage.locked > 0 && coverage.ready === 0,
      startHere: frontier[0]?.conceptId ?? null,
      startHereLabel: frontier[0]?.label ?? null,
      frontier,
    };
  });
}

export interface TrajectoryItem {
  conceptId: string;
  label: string;
  status: ConceptStatus;
  step: number; // 1-based overall position (done + remaining) — used in the chat prompt
  clusterName: string | null;
  isYouAreHere: boolean;
}

export interface Trajectory {
  doneCount: number; // mastered concepts (collapsed into the "✓ N done" header)
  items: TrajectoryItem[]; // remaining concepts, in learning order
}

// A linear learning order of the remaining (not-mastered) concepts: a best-first
// topological sort over the prerequisite_of subgraph restricted to not-done
// concepts. At each step the most foundational available concept emits first
// (prerequisite_of out-degree desc, then total degree desc, then label asc).
// Mastered concepts collapse into doneCount. part_of/generalizes do not order
// (only prerequisite_of). Self-loops ignored. Cycles among not-done concepts
// never become available; they are appended at the end by label asc so the
// trajectory stays complete (no infinite loop). isYouAreHere = the first
// in_progress item if any, else the first ready item.
export function computeTrajectory(
  concepts: { id: string }[],
  edges: { source: string; target: string; relation: string }[],
  statuses: Map<string, ConceptStatus>,
  labelById: Map<string, string>,
  clusterNameById: Map<string, string>,
): Trajectory {
  let doneCount = 0;
  const notDone: string[] = [];
  const statusOf = new Map<string, ConceptStatus>();
  for (const c of concepts) {
    const st = statuses.get(c.id);
    if (st == null) continue;
    if (st === "mastered") doneCount++;
    else {
      notDone.push(c.id);
      statusOf.set(c.id, st);
    }
  }
  if (notDone.length === 0) return { doneCount, items: [] };

  const notDoneSet = new Set(notDone);

  // Graph-wide prerequisite_of out-degree + total degree (tiebreak inputs).
  const prereqOut = new Map<string, number>();
  const totalDeg = new Map<string, number>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    totalDeg.set(e.source, (totalDeg.get(e.source) ?? 0) + 1);
    totalDeg.set(e.target, (totalDeg.get(e.target) ?? 0) + 1);
    if (e.relation === "prerequisite_of") {
      prereqOut.set(e.source, (prereqOut.get(e.source) ?? 0) + 1);
    }
  }

  // Not-done prerequisite adjacency (Kahn over the not-done subgraph).
  const prereqs = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const inDeg = new Map<string, number>();
  for (const id of notDone) {
    prereqs.set(id, new Set());
    dependents.set(id, new Set());
    inDeg.set(id, 0);
  }
  for (const e of edges) {
    if (e.relation !== "prerequisite_of" || e.source === e.target) continue;
    if (notDoneSet.has(e.target) && notDoneSet.has(e.source)) {
      prereqs.get(e.target)!.add(e.source);
      dependents.get(e.source)!.add(e.target);
    }
  }
  for (const id of notDone) inDeg.set(id, prereqs.get(id)!.size);

  const labelOf = (id: string) => labelById.get(id) ?? id;
  // Best-first: most foundational (prereq out-degree desc, total degree desc, label asc).
  const better = (a: string, b: string): number => {
    const oa = prereqOut.get(a) ?? 0, ob = prereqOut.get(b) ?? 0;
    if (ob !== oa) return ob - oa;
    const da = totalDeg.get(a) ?? 0, db = totalDeg.get(b) ?? 0;
    if (db !== da) return db - da;
    return labelOf(a).localeCompare(labelOf(b));
  };

  let avail = notDone.filter((id) => inDeg.get(id) === 0).sort(better);
  const emitted: string[] = [];
  const emittedSet = new Set<string>();
  while (avail.length > 0) {
    const id = avail.shift()!;
    emitted.push(id);
    emittedSet.add(id);
    const newlyAvail: string[] = [];
    for (const dep of dependents.get(id)!) {
      const d = (inDeg.get(dep) ?? 0) - 1;
      inDeg.set(dep, d);
      if (d === 0) newlyAvail.push(dep);
    }
    if (newlyAvail.length > 0) avail = [...avail, ...newlyAvail].sort(better);
  }

  // Cycle fallback: append unemitted not-done concepts by label asc.
  if (emittedSet.size < notDone.length) {
    const rest = notDone.filter((id) => !emittedSet.has(id)).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
    emitted.push(...rest);
  }

  let youAreHereIdx = -1;
  for (let i = 0; i < emitted.length; i++) {
    if (statusOf.get(emitted[i]) === "in_progress") { youAreHereIdx = i; break; }
  }
  if (youAreHereIdx === -1) {
    for (let i = 0; i < emitted.length; i++) {
      if (statusOf.get(emitted[i]) === "ready") { youAreHereIdx = i; break; }
    }
  }

  const items: TrajectoryItem[] = emitted.map((id, i) => ({
    conceptId: id,
    label: labelOf(id),
    status: statusOf.get(id)!,
    step: doneCount + i + 1,
    clusterName: clusterNameById.get(id) ?? null,
    isYouAreHere: i === youAreHereIdx,
  }));

  return { doneCount, items };
}
