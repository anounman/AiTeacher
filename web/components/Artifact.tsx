"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";

// Resize script injected into the artifact's HTML so the iframe reports its
// content height to the parent (which sets the iframe height). The previous
// version reported on every ResizeObserver tick and the parent applied every
// value unconditionally — for content sized to the viewport (height:100% /
// 100vh) or with a scrollbar, setting the iframe height changes the measured
// content height, so the observer fires again, oscillating by ~1px forever
// (a feedback loop). That loop re-rendered the parent on every tick, so the
// page thrashed — the artifact flickered and you couldn't scroll.
//
// This script breaks the loop: it measures, coalesces ticks into a single
// rAF, and only posts when the height moved by more than a small threshold —
// so 1px oscillations (scrollbar show/hide, subpixel rounding) never produce a
// message, and genuinely settling content reports once and stops. A short
// poll covers async CDN renders the ResizeObserver might miss on initial
// layout.
const RESIZE_SCRIPT = `<script>(function(){var last=-1;function measure(){var h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);if(h>0&&Math.abs(h-last)>=3){last=h;parent.postMessage({__artifactHeight:h},"*");}}var raf=0;function schedule(){if(raf)return;raf=requestAnimationFrame(function(){raf=0;measure();});}if(document.readyState==="complete")schedule();else window.addEventListener("load",schedule);if(typeof ResizeObserver!=="undefined"){try{new ResizeObserver(schedule).observe(document.body);}catch(e){}}var n=0,iv=setInterval(function(){schedule();if(++n>=10)clearInterval(iv);},300);})();<\/script>`;

// Inject the resize script just before </body> when the model emitted a full
// HTML document, else append it (handles HTML fragments too).
function withResizeScript(html: string): string {
  const i = html.lastIndexOf("</body>");
  return i >= 0 ? html.slice(0, i) + RESIZE_SCRIPT + html.slice(i) : html + RESIZE_SCRIPT;
}

// Floor on the iframe height: while a CDN lib loads the body can momentarily
// be near-empty, and we don't want the iframe to collapse to a sliver (the
// "artifact comes and doesn't stay visible" symptom). Once the real content
// reports in, this floor is irrelevant. Cap tall artifacts so they scroll
// inside the frame instead of stretching the page.
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 1200;

// Renders a model-authored HTML visualization in a sandboxed iframe. The
// sandbox is `allow-scripts` WITHOUT `allow-same-origin`, so the artifact can
// run JS (and load CDN libs like Chart.js / Mermaid / Three.js) but cannot
// touch the parent page, cookies, or localStorage — making it safe to render
// arbitrary model output inline. The iframe height is driven by the content
// via postMessage (see RESIZE_SCRIPT); floored/capped with internal scroll
// for very tall artifacts.
//
// Memoized so a parent re-render (e.g. another message streaming) does NOT
// recompute srcDoc and reload the iframe. Height changes go through style
// only, which never reloads the document.
export const Artifact = memo(function Artifact({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);
  const [copied, setCopied] = useState(false);
  // srcDoc is a pure function of html — memoize so the prop reference is
  // stable across re-renders and React never touches the iframe's srcdoc.
  const srcDoc = useMemo(() => withResizeScript(html), [html]);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      // The iframe has a null origin (sandboxed), so don't check origin — only
      // honor messages whose source is THIS iframe's window.
      if (e.source !== ref.current?.contentWindow) return;
      const h = (e.data as { __artifactHeight?: number } | null)?.__artifactHeight;
      if (typeof h !== "number" || h <= 0) return;
      // Functional update with a threshold: only re-render when the height
      // actually moved meaningfully. This is the parent-side half of the
      // anti-oscillation guard — identical or sub-threshold reports bail out
      // (React skips the re-render), so a stream of near-equal measurements
      // can't thrash the page.
      setHeight((prev) => {
        const next = Math.max(MIN_HEIGHT, Math.min(h, MAX_HEIGHT));
        return Math.abs(next - prev) >= 3 ? next : prev;
      });
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  async function copyHtml() {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
  }

  function openInTab() {
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  }

  return (
    <div className="my-3 overflow-hidden rounded-card border border-border bg-surface-2 shadow-card">
      <div className="mono flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-[10px] tracking-wide text-content-faint">
        <span className="h-1 w-1 rounded-full bg-rule" />
        custom visualization
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={copied ? "Copied HTML" : "Copy HTML"} size="sm" onClick={copyHtml}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </IconButton>
          <IconButton label="Open in new tab" size="sm" onClick={openInTab}>
            <ExternalLink size={13} />
          </IconButton>
        </div>
      </div>
      <iframe
        ref={ref}
        title="visualization"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{ height }}
        className="block w-full border-0 bg-surface-2"
      />
    </div>
  );
});
