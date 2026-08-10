"use client";

import { useEffect, useRef, useState } from "react";
import { signalDone } from "@/lib/teach/completion";
import { performer } from "@/lib/teach/performer";
import { register } from "@/lib/teach/spatial";

// LaTeX rendered by MathJax to inline SVG paths, then "written": each glyph's
// outline is pen-traced via stroke-dashoffset, then filled; rules/bars grow
// in. Slight per-glyph rotation jitter breaks the typeset stiffness. This is
// the interim math hand (ARCHITECTURE §8 stage 1) until a LaTeX→ink model
// exists.
//
// Uses the self-contained MathJax v3 browser build served from
// /mathjax/tex-svg.js (script tag, window.MathJax) — its deep ESM imports
// hang under Turbopack, the bundled build sidesteps the bundler entirely.

declare global {
  interface Window {
    MathJax?: {
      tex2svg?: (tex: string, opts?: { display?: boolean }) => HTMLElement;
      startup?: unknown;
      svg?: unknown;
    };
  }
}

// djb2 — stable fallback equation id when the model omitted one
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return h | 0;
}

let mjPromise: Promise<(tex: string) => SVGSVGElement | null> | null = null;

export function loadMathJax(): Promise<(tex: string) => SVGSVGElement | null> {
  if (mjPromise) return mjPromise;
  mjPromise = new Promise((resolve, reject) => {
    // fontCache "none" inlines every glyph as its own <path> — required for
    // per-glyph stroke animation (cached <use> refs can't be dash-animated).
    window.MathJax = { svg: { fontCache: "none" }, startup: { typeset: false } };
    const script = document.createElement("script");
    // full build: every tex extension inlined (\cssId needs `html`; the slim
    // build would try to autoload it from a path we don't serve)
    script.src = "/mathjax/tex-svg-full.js";
    script.async = true;
    script.onload = () => {
      const poll = setInterval(() => {
        if (window.MathJax?.tex2svg) {
          clearInterval(poll);
          resolve((tex: string) => {
            const container = window.MathJax!.tex2svg!(tex, { display: true });
            return container.querySelector("svg");
          });
        }
      }, 100);
      setTimeout(() => {
        clearInterval(poll);
        reject(new Error("MathJax startup timeout"));
      }, 20_000);
    };
    script.onerror = () => reject(new Error("MathJax script failed to load"));
    document.body.appendChild(script);
  });
  return mjPromise;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

async function animateWriteOn(container: HTMLElement): Promise<void> {
  const glyphs = Array.from(
    container.querySelectorAll<SVGGraphicsElement>("svg path, svg rect, svg line"),
  );
  if (!glyphs.length || prefersReducedMotion()) return;

  const totalMs = Math.min(3500, 220 * glyphs.length + 300);
  const per = totalMs / glyphs.length;

  for (const g of glyphs) {
    g.style.visibility = "hidden";
  }
  for (const g of glyphs) {
    while (performer.paused()) await new Promise((r) => setTimeout(r, 150));
    g.style.visibility = "";
    if (g instanceof SVGPathElement) {
      let len = 0;
      try {
        len = g.getTotalLength();
      } catch {
        /* detached */
      }
      if (len > 0) {
        const jitter = (Math.random() * 1.4 - 0.7).toFixed(2);
        g.style.transformBox = "fill-box";
        g.style.transformOrigin = "center";
        g.style.transform = `rotate(${jitter}deg)`;
        g.style.fill = "none";
        g.style.stroke = "currentColor";
        g.style.strokeWidth = "18";
        g.style.strokeDasharray = String(len);
        g.style.strokeDashoffset = String(len);
        g.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
          duration: per * 1.4,
          easing: "ease-out",
          fill: "forwards",
        });
        setTimeout(() => {
          g.style.fill = "currentColor";
          g.style.strokeWidth = "6";
        }, per * 1.1);
      }
    } else {
      // fraction bars, rules
      g.style.transformBox = "fill-box";
      g.style.transformOrigin = "left center";
      g.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
        duration: per,
        easing: "ease-out",
        fill: "forwards",
      });
    }
    await new Promise((r) => setTimeout(r, per * 0.55));
  }
  // Let the last glyph finish filling.
  await new Promise((r) => setTimeout(r, per));
}

export function MathWriteOn({
  tex,
  itemKey,
  eqId,
  instant = false,
}: {
  tex: string;
  itemKey?: string;
  eqId?: string;
  instant?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // Dedup via the DOM node (survives StrictMode's double effect run); the
  // async work deliberately has no cancellation — it must run to completion
  // so the orchestrator's completion signal always fires.
  useEffect(() => {
    const host = ref.current;
    if (!host || host.dataset.started) return;
    host.dataset.started = "1";
    (async () => {
      try {
        const tex2svg = await loadMathJax();
        const svg = tex2svg(tex);
        if (!svg) throw new Error("no svg");
        host.replaceChildren(svg);
        // Natural size — the container scrolls horizontally. maxWidth:100%
        // would shrink long expressions into unreadable miniatures.
        svg.style.color = "inherit";
        svg.style.overflow = "visible";

        // Spatial registration: equation, its \cssId parts, and every
        // character token (mi/mn/mo groups) — the board knows where each
        // symbol sits (queried via BVH on demand).
        const eq = eqId || itemKey || `eq-${Math.abs(hash(tex))}`;
        register({ id: eq, kind: "equation", itemKey: itemKey ?? eq, el: svg, tex });
        svg.querySelectorAll<SVGGraphicsElement>("[id]").forEach((part) => {
          if (part.id.startsWith("MJX-")) return; // MathJax internals
          register({ id: `${eq}#${part.id}`, kind: "part", itemKey: itemKey ?? eq, el: part, tex });
        });
        svg
          .querySelectorAll<SVGGraphicsElement>(
            'g[data-mml-node="mi"], g[data-mml-node="mn"], g[data-mml-node="mo"]',
          )
          .forEach((tok, i) => {
            register({ id: `${eq}/t${i}`, kind: "token", itemKey: itemKey ?? eq, el: tok, tex });
          });

        if (!instant) await animateWriteOn(host);
      } catch {
        setFailed(true);
      } finally {
        if (itemKey) signalDone(itemKey);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return <code className="mono text-[13px] text-ink-2">{tex}</code>;
  return (
    <div
      ref={ref}
      data-eq-id={eqId}
      className="math-writeon overflow-x-auto py-1 text-[1.3rem]"
    />
  );
}
