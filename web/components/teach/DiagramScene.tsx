"use client";

import { useEffect, useState } from "react";
import { VisualCanvas } from "@/components/visual/VisualCanvas";
import { signalDone } from "@/lib/teach/completion";
import type { TeachAction } from "@/lib/teach/protocol";
import type { PositionedGraph } from "@/lib/visual-engine/index";

type DiagramAction = Extract<TeachAction, { type: "diagram" }>;

// A diagram on the board, drawn by the visual engine.
//
// This is what [G] and [DRAW] used to do. The difference is where the layout
// comes from: the model names the concept and never places anything, so the
// crude sketches and overlapping boxes it used to position by hand are not
// expressible. Geometry is checked before the diagram is accepted
// (lib/visual-engine-guard).
//
// Failure is silent. Everything the diagram shows was also spoken, and an
// error card in the middle of a lesson is worse than no picture.

const cache = new Map<string, Promise<PositionedGraph | null>>();

export function diagramGraph(concept: string): Promise<PositionedGraph | null> {
  const key = concept.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const request = fetch("/api/teach/diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concept }),
    signal: AbortSignal.timeout(120_000),
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { graph?: PositionedGraph };
      return data.graph ?? null;
    })
    .catch(() => null);
  cache.set(key, request);
  return request;
}

export function DiagramScene({
  action,
  itemKey,
}: {
  action: DiagramAction;
  itemKey: string;
}) {
  const [graph, setGraph] = useState<PositionedGraph | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void diagramGraph(action.concept).then((result) => {
      if (!alive) return;
      if (result) setGraph(result);
      else setFailed(true);
      // Release the beat either way: the pen must not wait on a picture.
      signalDone(itemKey);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  if (failed) return null;
  if (!graph) {
    return (
      <div className="mono my-3 text-[11px] text-ink-3" aria-live="polite">
        drawing…
      </div>
    );
  }
  return (
    <figure className="my-4 overflow-x-auto">
      <VisualCanvas graph={graph} />
    </figure>
  );
}
