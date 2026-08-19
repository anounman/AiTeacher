// Presentational cluster-card grid for the /graph overview (Task 3 of the
// Topic Map redesign). Receives precomputed per-cluster stats from the page
// (Task 4 wires it in) and renders a scannable CSS grid of cards. No hooks,
// no state — a plain component. Studio Notebook tokens only.

import { motion } from "motion/react";
import { ArrowRight, Lock } from "lucide-react";
import type { ClusterStatus } from "@/lib/graph/learning-path";
import type { Cluster } from "@/lib/graph/clusters";
import type { ClusterMastery } from "@/lib/graph/cluster-stats";
import { representativeConcepts } from "@/lib/graph/cluster-stats";
import { useMotion, fadeUp } from "@/lib/motion";

interface ClusterOverviewProps {
  clusters: Cluster[];
  masteryByCluster: Map<string, ClusterMastery>;
  externalLinksByCluster: Map<string, number>;
  degreeMap: Map<string, number>;
  labelById: Map<string, string>;
  onSelectCluster: (clusterId: string) => void;
  // Learning-path mode: when on, cards render a status bar + coverage % +
  // start-here entrypoint + complete/blocked badges instead of the mastery
  // band bar. clusterStatuses keyed by cluster id.
  clusterStatuses?: Map<string, ClusterStatus> | null;
  pathMode?: boolean;
  // Drill into a cluster and select its start-here concept (top ready concept).
  onSelectStartHere?: (clusterId: string, conceptId: string) => void;
}

// Mastery band segments, rendered in this fixed order so every bar reads the
// same way left→right. Untested + unknown are bucketed into one faint segment
// (their counts summed) — matches the band-border mapping for untested/unknown.
const SEGMENTS: Array<{
  key: "strong" | "learning" | "slipping" | "un";
  className: string;
}> = [
  { key: "strong", className: "bg-band-strong" },
  { key: "learning", className: "bg-band-learning" },
  { key: "slipping", className: "bg-band-slipping" },
  { key: "un", className: "bg-content-faint/50" },
];

export function ClusterOverview({
  clusters,
  masteryByCluster,
  externalLinksByCluster,
  degreeMap,
  labelById,
  onSelectCluster,
  clusterStatuses = null,
  pathMode = false,
  onSelectStartHere,
}: ClusterOverviewProps) {
  const m = useMotion();

  if (clusters.length === 0) {
    return <div className="mono text-[12px] text-content-faint">no clusters</div>;
  }

  return (
    <motion.div
      {...m}
      variants={fadeUp}
      className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
    >
      {clusters.map((cluster) => {
        const cm = masteryByCluster.get(cluster.id) ?? {
          strong: 0,
          learning: 0,
          slipping: 0,
          untested: 0,
          unknown: 0,
        };
        const un = cm.untested + cm.unknown;
        const total = cm.strong + cm.learning + cm.slipping + un;
        const segments: Array<{ className: string; pct: number }> = [];
        if (total > 0) {
          for (const seg of SEGMENTS) {
            const count = seg.key === "un" ? un : cm[seg.key];
            if (count > 0) segments.push({ className: seg.className, pct: (count / total) * 100 });
          }
        }
        const reps = representativeConcepts(cluster, degreeMap, labelById, 3);
        const external = externalLinksByCluster.get(cluster.id) ?? 0;
        const cs = pathMode ? clusterStatuses?.get(cluster.id) ?? null : null;
        const statusSegs: Array<{ className: string; pct: number }> = [];
        if (cs) {
          const total = cs.coverage.total;
          if (total > 0) {
            const push = (count: number, cls: string) => {
              if (count > 0) statusSegs.push({ className: cls, pct: (count / total) * 100 });
            };
            push(cs.coverage.mastered, "bg-feynman");
            push(cs.coverage.inProgress, "bg-band-learning");
            push(cs.coverage.ready, "bg-rule");
            push(cs.coverage.locked, "bg-content-faint/40");
          }
        }

        return (
          <motion.div
            key={cluster.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectCluster(cluster.id)}
            onKeyDown={(e) => {
              // Keyboard-activate the card like a button (Enter / Space). Only
              // act when the card itself is focused — not when a nested focusable
              // element (the start-here button) is, so Enter on start-here
              // doesn't double-fire the card's drill-in.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectCluster(cluster.id);
              }
            }}
            className="group rounded-[4px] border border-border bg-surface p-4 text-left shadow-card transition-[border-color,transform] duration-fast ease-out hover:border-border-strong focus:outline-none focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-ring-accent/40"
          >
            <div className="mono line-clamp-2 text-[13px] leading-tight text-ink">
              {cluster.name}
            </div>
            <div className="mono mt-1 text-[10px] text-content-faint">
              {cluster.conceptCount} concepts
            </div>

            {/* Path mode: status bar (mastered/in-progress/ready/locked) +
                coverage % + start-here + flags. Normal mode: mastery band bar. */}
            {pathMode && cs ? (
              <>
                <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-2">
                  {statusSegs.map((seg, i) => (
                    <div key={i} className={seg.className} style={{ width: `${seg.pct}%` }} />
                  ))}
                </div>
                <div className="mono mt-1.5 flex items-center gap-2 text-[10px] text-content-faint">
                  <span>{cs.coverage.percent}% · {cs.coverage.ready} ready</span>
                  {cs.complete && <span className="text-feynman">✓ complete</span>}
                  {cs.blocked && <span className="text-content-faint">· locked</span>}
                </div>
                {cs.startHere && cs.startHereLabel && onSelectStartHere ? (
                  <button
                    onClick={(e) => {
                      // Stop the click bubbling to the card's onClick — otherwise
                      // the card's onSelectCluster fires after this and clears
                      // the selection this entrypoint just set.
                      e.stopPropagation();
                      onSelectStartHere(cluster.id, cs.startHere!);
                    }}
                    className="mono mt-2 flex w-full items-center gap-1 truncate rounded-[3px] border border-border bg-surface px-2 py-1 text-left text-[11px] text-content-muted transition-colors hover:border-border-strong hover:text-ink"
                  >
                    <span className="shrink-0 text-rule">start here:</span>
                    <span className="truncate text-ink">{cs.startHereLabel}</span>
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-2">
                  {segments.map((seg, i) => (
                    <div key={i} className={seg.className} style={{ width: `${seg.pct}%` }} />
                  ))}
                </div>
                <div className="mono mt-1.5 text-[10px] text-content-faint">
                  {cm.strong}S {cm.learning}L {cm.slipping} slip {un} un
                </div>
              </>
            )}

            {/* Representative concept labels. */}
            <div className="mt-3">
              {reps.map((label) => (
                <div key={label} className="mono mt-0.5 truncate text-[11px] text-content-muted">
                  · {label}
                </div>
              ))}
            </div>

            {pathMode && cs?.blocked && (
              <div className="mono mt-1 flex items-center gap-1 text-[10px] text-content-faint">
                <Lock size={10} /> prerequisites needed
              </div>
            )}

            <div className="mono mt-3 flex items-center gap-1 text-[10px] text-content-faint transition-colors group-hover:text-content-muted">
              <ArrowRight size={11} /> {external} external links
            </div>

            {/* Isolated cluster drill-down is a flat row (no intra-cluster
                edges); head that off for large isolated buckets. */}
            {cluster.id === "isolated" && cluster.conceptCount > 40 && (
              <div className="mono mt-1 text-[10px] text-content-faint">
                no internal links — flat drill-down
              </div>
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
}