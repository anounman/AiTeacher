"use client";

import { VisualCanvas } from "@/components/visual/VisualCanvas";
import type { PositionedGraph } from "@/lib/visual-engine/index";

// A visual-engine diagram on the teach board.
//
// Bare, like the hand-drawn `[DRAW]` scenes beside it — no card chrome, no
// border. The board's own paper is the background; a framed panel would read
// as a foreign object dropped onto the whiteboard rather than something the
// teacher drew.
export function ConceptGraphScene({
  graph,
  title,
  summary,
}: {
  graph: PositionedGraph | null;
  title?: string;
  summary?: string;
}) {
  if (!graph?.nodes?.length) return null;
  return (
    <figure className="my-4 flex flex-col gap-2">
      {title && (
        <figcaption className="text-ink-2" style={{ fontFamily: "var(--font-serif)" }}>
          {title}
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <VisualCanvas graph={graph} />
      </div>
      {summary && <p className="mono text-[11px] text-ink-3">{summary}</p>}
    </figure>
  );
}
