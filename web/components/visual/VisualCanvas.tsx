"use client";

import { useEffect, useRef } from "react";
import { drawConcept, type PositionedGraph } from "@/lib/visual-engine/index";

// Stage 3 of the visual engine runs here, in the browser, because rough.js
// draws into a live <svg>. Stages 1 and 2 (decompose, layout) ran on the
// server — see app/api/visualize/route.ts. That split is the engine's own
// design: the graph it hands over is pure geometry, so this component is the
// only part that needs a DOM.
//
// Re-rendering is safe and idempotent: drawConcept clears the svg first, and
// every rough.js shape is seeded from its element id, so the same graph always
// produces the same sketch rather than re-wobbling on each paint.

export function VisualCanvas({
  graph,
  theme,
  className,
}: {
  graph: PositionedGraph | null;
  theme?: Parameters<typeof drawConcept>[2] extends { theme?: infer T } ? T : never;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !graph) return;
    drawConcept(svg, graph, theme ? { theme } : {});
  }, [graph, theme]);

  if (!graph) return null;
  return (
    <svg
      ref={ref}
      className={className}
      // The engine sets viewBox/width/height itself; this keeps the drawing
      // inside its column on a phone without distorting it.
      style={{ maxWidth: "100%", height: "auto" }}
      role="img"
      aria-label="hand-drawn concept diagram"
    />
  );
}
