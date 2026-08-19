"use client";

// The learning-path trajectory panel for /graph — a linear "first do this,
// then that" list of the remaining (not-mastered) concepts in topological
// learning order, colored by status (green done [collapsed into the header] /
// yellow in progress / red not done), with a "you are here" marker on the
// actionable focus. Each row has an "ask in chat" link that hands off to the
// project's chat with a prefilled study prompt. Presentational — only an
// auto-scroll ref for the "you are here" row. Studio Notebook tokens only.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import type { Trajectory } from "@/lib/graph/learning-path";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

interface LearningPathTrajectoryProps {
  trajectory: Trajectory | null;
  projectId: string | null;
  selectedId: string | null;
  onSelect: (conceptId: string) => void;
  buildAskPrompt: (label: string, step: number) => string;
}

export function LearningPathTrajectory({
  trajectory,
  projectId,
  selectedId,
  onSelect,
  buildAskPrompt,
}: LearningPathTrajectoryProps) {
  const hereRef = useRef<HTMLLIElement | null>(null);

  // Auto-scroll the "you are here" row into view on load / data change.
  useEffect(() => {
    hereRef.current?.scrollIntoView({ block: "nearest" });
  }, [trajectory]);

  if (!trajectory) return null;

  if (trajectory.items.length === 0) {
    return (
      <Card className="p-4">
        <div className="mono mb-2 text-[10px] tracking-wide text-content-faint">LEARNING PATH</div>
        <div className="mono flex items-center gap-1.5 text-[12px] text-content-faint">
          ✓ path complete · {trajectory.doneCount} done
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex max-h-[70vh] flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="mono text-[10px] tracking-wide text-content-faint">LEARNING PATH</span>
        <span className="mono text-[10px] text-content-faint">✓ {trajectory.doneCount} done</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ul>
          {trajectory.items.map((it) => {
            const inProgress = it.status === "in_progress";
            const askHref = projectId
              ? `/?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(buildAskPrompt(it.label, it.step))}`
              : null;
            return (
              <li
                key={it.conceptId}
                ref={it.isYouAreHere ? hereRef : undefined}
                className={cn(
                  "group relative flex items-center gap-2 border-b border-border/60 px-3 py-2 transition-colors",
                  it.isYouAreHere ? "bg-surface-2" : it.conceptId === selectedId ? "bg-surface-2/60" : "hover:bg-surface-2/40",
                )}
              >
                {it.isYouAreHere && (
                  <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-rule" />
                )}
                <button
                  onClick={() => onSelect(it.conceptId)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      inProgress ? "bg-band-learning" : "bg-rule",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "mono block truncate text-[12px] leading-tight",
                        inProgress ? "text-band-learning" : "text-rule",
                      )}
                    >
                      {it.isYouAreHere && <span className="mr-0.5">▸</span>}
                      {it.label}
                    </span>
                    <span className="mono block truncate text-[10px] leading-tight text-content-faint">
                      {it.isYouAreHere
                        ? it.status === "in_progress"
                          ? "you are here"
                          : "start here"
                        : it.clusterName ?? ""}
                    </span>
                  </span>
                </button>
                {it.status === "locked" && (
                  <Lock size={11} className="shrink-0 text-content-faint" />
                )}
                {askHref && (
                  <Link
                    href={askHref}
                    aria-label={`Ask in chat about ${it.label}`}
                    className={cn(
                      "mono shrink-0 rounded-[3px] border border-border bg-surface px-1.5 py-0.5 text-[10px] text-content-muted transition-colors hover:border-border-strong hover:text-ink",
                      it.isYouAreHere ? "inline-flex" : "hidden group-hover:inline-flex",
                    )}
                  >
                    ask
                    <ArrowUpRight size={10} className="-ml-0.5 inline align-baseline" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
