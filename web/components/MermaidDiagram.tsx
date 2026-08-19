"use client";

import { useId, useState, useEffect } from "react";
import mermaid from "mermaid";
import { ArtifactFrame } from "@/components/artifacts/ArtifactFrame";

// Renders a ```mermaid fence (entity-relationship, flow, sequence, …) to inline
// SVG inside the chat / print page. Mermaid is the canonical format the model
// emits for diagrams; without this a bare mermaid fence falls through to
// CodeBlock and renders as code. Inline SVG (not an iframe) so it also prints
// crisply into the headless-Chromium PDF.

// Initialize once at module load. Strict mode keeps diagrams static: Mermaid
// sanitizes generated SVG and does not bind model-provided click callbacks.
export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  fontFamily: "var(--font-sans)",
  themeCSS: `
    .node rect, .node circle, .node ellipse, .node polygon { fill: var(--surface) !important; stroke: var(--border-strong) !important; }
    .cluster rect { fill: var(--surface-2) !important; stroke: var(--border) !important; }
    .label, .label text, text { color: var(--content) !important; fill: var(--content) !important; }
    .nodeLabel, .nodeLabel p, .nodeLabel span, foreignObject div { color: var(--content) !important; font-family: var(--font-sans) !important; }
    .edgePath .path { stroke: var(--content-muted) !important; }
    .arrowheadPath { fill: var(--content-muted) !important; }
  `,
} as const;

mermaid.initialize(MERMAID_CONFIG);

// Track in-flight renders so the print page can wait for diagrams to finish
// before signalling data-print-ready (see app/print/[id]/page.tsx). Each
// MermaidDiagram inc's on render start and dec's on settle; the print page
// drains __pendingRenders to 0 before marking the page ready for the PDF.
const g = globalThis as unknown as { __pendingRenders?: number };
const incPending = () => {
  g.__pendingRenders = (g.__pendingRenders ?? 0) + 1;
};
const decPending = () => {
  g.__pendingRenders = Math.max(0, (g.__pendingRenders ?? 0) - 1);
};

// Mermaid sometimes resolves `render()` with an SVG containing its parser
// error screen rather than rejecting the promise. Never inject that SVG into
// the chat as though it were a real diagram.
export function isMermaidErrorSvg(svg: string): boolean {
  return /syntax error in text/i.test(svg) && /mermaid version\s+\d/i.test(svg);
}

export function MermaidGraphic({ code }: { code: string }) {
  const reactId = useId();
  // useId() yields ":r0:"-style strings; strip non-alphanumerics for a valid
  // SVG element id (mermaid uses it internally).
  const id = "mmd-" + reactId.replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    incPending();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFailed(false);
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (cancelled) return;
        if (isMermaidErrorSvg(svg)) {
          setFailed(true);
          setSvg(null);
          return;
        }
        setSvg(svg);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setSvg(null);
        }
      })
      .finally(() => {
        settled = true;
        if (!cancelled) decPending();
      });
    // Dec exactly once per inc: if the render settled, .finally decs; if it's
    // still in flight when we clean up (unmount / code change), the cleanup
    // decs instead. `settled` keeps the two paths from double-decrementing.
    return () => {
      cancelled = true;
      if (!settled) decPending();
    };
  }, [code, id]);

  if (failed) {
    return (
      <div>
        <div className="mono mb-1.5 text-[11px] text-danger">invalid mermaid — showing source</div>
        <pre className="mono overflow-x-auto text-[12px] leading-5 text-content-muted">{code}</pre>
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="mono flex items-center gap-1.5 text-[12px] text-content-faint">
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-rule" />
        rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="overflow-x-auto [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function MermaidDiagram({ code }: { code: string }) {
  return (
    <ArtifactFrame kind="diagram">
      <MermaidGraphic code={code} />
    </ArtifactFrame>
  );
}
