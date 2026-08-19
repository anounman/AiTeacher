"use client";

// The "Next up" frontier panel for the cluster drill-down (learning-path mode
// only). Lists the cluster's READY concepts ranked by prerequisite_of
// out-degree (most-foundational first), each clickable to select + center the
// concept. Stacked above DetailPanel in the right column. Empty states cover
// "cluster complete", "blocked (prerequisites in another cluster)", and
// "in progress (no ready concepts yet)".

import { Check, Lock } from "lucide-react";
import type { ClusterStatus } from "@/lib/graph/learning-path";
import { Card } from "@/components/ui/Card";

interface NextUpPanelProps {
  clusterStatus: ClusterStatus | null;
  onSelect: (conceptId: string) => void;
}

export function NextUpPanel({ clusterStatus, onSelect }: NextUpPanelProps) {
  if (!clusterStatus) return null;

  const title = (
    <div className="mono mb-2 text-[10px] tracking-wide text-content-faint">NEXT UP</div>
  );

  if (clusterStatus.complete) {
    return (
      <Card className="p-4">
        {title}
        <div className="mono flex items-center gap-1.5 text-[12px] text-content-muted">
          <Check size={12} className="text-feynman" />
          cluster complete
        </div>
      </Card>
    );
  }

  if (clusterStatus.frontier.length === 0) {
    const blocked = clusterStatus.blocked;
    return (
      <Card className="p-4">
        {title}
        <div className="mono flex items-center gap-1.5 text-[12px] text-content-muted">
          {blocked ? (
            <>
              <Lock size={12} className="text-content-faint" />
              blocked — prerequisites in another cluster
            </>
          ) : (
            <>
              <Check size={12} className="text-content-faint" />
              in progress — no ready concepts yet
            </>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      {title}
      <ul className="flex flex-col gap-1">
        {clusterStatus.frontier.map((f) => (
          <li key={f.conceptId}>
            <button
              onClick={() => onSelect(f.conceptId)}
              className="mono flex w-full items-center gap-2 truncate text-left text-[11px] text-content-muted hover:text-ink"
              title={`${f.label} · ${f.dependents} depend on this`}
            >
              <span className="truncate text-ink">{f.label}</span>
              <span className="shrink-0 text-content-faint">· {f.dependents} depend</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}