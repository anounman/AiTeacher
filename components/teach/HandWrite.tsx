"use client";

import { useEffect, useRef, useState } from "react";
import { signalDone } from "@/lib/teach/completion";
import { performer } from "@/lib/teach/performer";
import { register } from "@/lib/teach/spatial";

// Board content written by the mathwriter engine (real handwritten glyphs,
// via /api/handwrite → python sidecar). The PNG is revealed band-by-band
// (text lines detected from the alpha channel) with a left→right pen wipe,
// pausable via the performer. Each band gets an invisible overlay div with
// data-part="L<n>" so marks and the spatial index can target lines.

// `parts` are named regions the diagram engine knows about (ER entity boxes,
// relationship diamonds) in image pixels — what makes "point at the Doctor
// box" possible instead of circling the whole drawing.
export interface RenderPart {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
type RenderResult = { png: string; w: number; h: number; parts?: RenderPart[] };

// Size hierarchy from the Stitch design (design/live-lesson-stitch.png),
// tightened ~28% after iPad testing: at the original sizes a heading filled a
// third of the screen width and a lesson felt like poster lettering, not
// notes. mathwriter's `scale` maps to roughly 40px of glyph height per 1.0
// (measured); now heading ≈42px, equations ≈29px, annotations ≈22px. The PNG
// is displayed at its natural pixel size — stretching it to a fixed container
// width is what flattened the hierarchy before.
export type WriteRole = "heading" | "equation" | "annotation";

const ROLE_SCALE: Record<WriteRole, number> = {
  heading: 1.05,
  equation: 0.72,
  annotation: 0.55,
};

const cache = new Map<string, Promise<RenderResult>>();

function themeHex(color: "ink" | "red" | "blue"): string {
  const varName = color === "red" ? "--rule" : color === "blue" ? "--feynman" : "--ink";
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  // Accept #rgb/#rrggbb; anything else (rgb(), oklch()) → canvas normalizes.
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return "#1f2020";
  c.fillStyle = raw || "#1f2020";
  const v = c.fillStyle; // normalized to #rrggbb for simple colors
  return /^#[0-9a-f]{6}$/i.test(v) ? v : "#1f2020";
}

// Diagrams may use the engine's semantic palette (red = the failure, green =
// committed, …). Those must NOT go through the dark-mode invert filter, which
// would turn red into cyan — so a diagram is rendered in the theme's real ink
// color up front and displayed unfiltered.
export function isDiagramMarkup(markup: string): boolean {
  return /\[(?:G|DRAW)\]/.test(markup);
}

// Main ink otherwise comes back as the same dark raster and is theme-adjusted
// with CSS. That keeps already-rendered/cached handwriting readable if the
// page changes theme after prefetch. Accent inks still use their theme token.
function renderHex(color: "ink" | "red" | "blue", diagram = false): string {
  return color === "ink" && !diagram ? "#1f2020" : themeHex(color);
}

function fetchRender(markup: string, hex: string, role: WriteRole): Promise<RenderResult> {
  const key = `${hex}|${role}|${markup}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch("/api/handwrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markup, color: hex, scale: ROLE_SCALE[role] }),
    });
    if (!res.ok) throw new Error(`handwrite ${res.status}`);
    return (await res.json()) as RenderResult;
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

// A heading is what the model marks with ~~…~~; everything else is an
// equation unless it was explicitly written in an annotation color.
export function roleFor(markup: string, color: "ink" | "red" | "blue"): WriteRole {
  if (/^\s*~~/.test(markup)) return "heading";
  return color === "ink" ? "equation" : "annotation";
}

// Write a short label into `host` with the mathwriter hand (used by mark
// annotations). Throws if the sidecar is unavailable so callers can fall back
// to plain text.
export async function writeLabel(
  host: HTMLElement,
  text: string,
  color: "ink" | "red" | "blue",
): Promise<void> {
  const { png, w, h } = await fetchRender(text, renderHex(color), "annotation");
  const img = new Image();
  img.src = `data:image/png;base64,${png}`;
  await img.decode();
  // max-width + auto height: a label wider than its margin host shrinks
  // proportionally instead of spilling over neighboring writing.
  img.style.cssText = `width:${w}px;height:auto;max-width:100%;display:block;`;
  if (color === "ink") img.className = "handwrite-ink-raster";
  img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: "forwards" });
  host.appendChild(img);
}

export function prefetchWrite(markup: string, color: "ink" | "red" | "blue"): void {
  try {
    void fetchRender(markup, renderHex(color, isDiagramMarkup(markup)), roleFor(markup, color)).catch(() => {});
  } catch {
    /* SSR */
  }
}

// Resolves when this write's handwriting raster is cached (or failed — the
// performer must never deadlock on a render error). Used by the performance
// pump to keep the pen and the voice on the same beat: speech holds briefly
// until the strokes it narrates are ready to appear.
export function writeReady(markup: string, color: "ink" | "red" | "blue"): Promise<void> {
  try {
    return fetchRender(markup, renderHex(color, isDiagramMarkup(markup)), roleFor(markup, color)).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

interface Band {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

// Text-line bands from the alpha channel: contiguous rows containing ink,
// split on gaps ≥ 8px.
function detectBands(img: HTMLImageElement): Band[] {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  if (!ctx) return [{ y0: 0, y1: img.naturalHeight, x0: 0, x1: img.naturalWidth }];
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  const rowInk: boolean[] = new Array(height).fill(false);
  const rowX0: number[] = new Array(height).fill(Infinity);
  const rowX1: number[] = new Array(height).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 20) {
        rowInk[y] = true;
        if (x < rowX0[y]!) rowX0[y] = x;
        if (x > rowX1[y]!) rowX1[y] = x;
      }
    }
  }
  const bands: Band[] = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y <= height; y++) {
    if (y < height && rowInk[y]) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0 && (++gap >= 8 || y === height)) {
      const y1 = y - gap + 1;
      let x0 = Infinity;
      let x1 = -1;
      for (let r = start; r < y1; r++) {
        if (rowX0[r]! < x0) x0 = rowX0[r]!;
        if (rowX1[r]! > x1) x1 = rowX1[r]!;
      }
      bands.push({ y0: start, y1, x0: x0 === Infinity ? 0 : x0, x1: x1 < 0 ? width : x1 });
      start = -1;
    }
  }
  return bands.length ? bands : [{ y0: 0, y1: height, x0: 0, x1: width }];
}

// Word segments inside one band: column alpha profile, split on gaps wide
// enough to be inter-word space (relative to band height so it scales with
// the writing size). Capped defensively.
function detectWords(img: HTMLImageElement, band: Band): { x0: number; x1: number }[] {
  const c = document.createElement("canvas");
  const bw = band.x1 - band.x0;
  const bh = band.y1 - band.y0;
  if (bw <= 4 || bh <= 2) return [{ x0: band.x0, x1: band.x1 }];
  c.width = bw;
  c.height = bh;
  const ctx = c.getContext("2d");
  if (!ctx) return [{ x0: band.x0, x1: band.x1 }];
  ctx.drawImage(img, band.x0, band.y0, bw, bh, 0, 0, bw, bh);
  const { data } = ctx.getImageData(0, 0, bw, bh);
  const colInk: boolean[] = new Array(bw).fill(false);
  for (let x = 0; x < bw; x++) {
    for (let y = 0; y < bh; y++) {
      if (data[(y * bw + x) * 4 + 3]! > 20) {
        colInk[x] = true;
        break;
      }
    }
  }
  const gapMin = Math.max(10, bh * 0.38);
  const words: { x0: number; x1: number }[] = [];
  let start = -1;
  let gap = 0;
  for (let x = 0; x <= bw; x++) {
    if (x < bw && colInk[x]) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0 && (++gap >= gapMin || x === bw)) {
      words.push({ x0: band.x0 + start, x1: band.x0 + x - gap + 1 });
      start = -1;
      if (words.length >= 40) break;
    }
  }
  return words.length ? words : [{ x0: band.x0, x1: band.x1 }];
}

export function HandWrite({
  markup,
  writeId,
  color = "ink",
  itemKey,
  instant = false,
}: {
  markup: string;
  writeId: string;
  color?: "ink" | "red" | "blue";
  itemKey?: string;
  instant?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.dataset.started) return;
    host.dataset.started = "1";
    (async () => {
      try {
        const role = roleFor(markup, color);
        const diagram = isDiagramMarkup(markup);
        const { png, w, h, parts } = await fetchRender(markup, renderHex(color, diagram), role);
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        // Natural size — the size hierarchy lives in the rendered pixels —
        // EXCEPT over-wide lines: the board column is 900px, and a long line
        // rendered at natural width (measured up to ~1190px) runs off the
        // column under the transcript panel, ghosting through its glass as
        // "overlapping writing". Scale only those down to fit; normal lines
        // keep their exact pixel size so the hierarchy stays intact.
        const MAX_W = 860;
        const dw = Math.min(w, MAX_W);
        const dh = Math.round((h * dw) / w) || h;
        canvas.style.cssText = `width:${dw}px;height:${dh}px;display:block;`;
        // Diagrams are already themed server-side; inverting them would
        // recolor the semantic palette (red → cyan).
        if (color === "ink" && !diagram) canvas.className = "handwrite-ink-raster";
        host.style.position = "relative";
        host.appendChild(canvas);
        const ctx = canvas.getContext("2d")!;

        const bands = detectBands(img);
        const markupLines = markup.split("\n").map((l) => l.trim()).filter(Boolean);
        const pct = (v: number, total: number) => `${(v / total) * 100}%`;
        bands.forEach((b, i) => {
          const lineText =
            markupLines[i] ?? markupLines[markupLines.length - 1] ?? markup.slice(0, 60);
          const overlay = document.createElement("div");
          overlay.setAttribute("data-part", `L${i}`);
          overlay.style.cssText = `position:absolute;left:${pct(b.x0, w)};top:${pct(b.y0, h)};width:${pct(b.x1 - b.x0, w)};height:${pct(b.y1 - b.y0, h)};pointer-events:none;`;
          host.appendChild(overlay);
          register({
            id: `${writeId}:L${i}`,
            kind: "textline",
            itemKey: itemKey ?? writeId,
            el: overlay,
            text: lineText,
          });
          // Word-level matrix ids: split the band on horizontal ink gaps and
          // register each word box as writeId:L<n>:W<m>, paired in order with
          // the markup's words (best effort — handwriting has no ground truth).
          const words = detectWords(img, b);
          const lineWords = lineText.split(/\s+/).filter(Boolean);
          words.forEach((seg, wi) => {
            const wEl = document.createElement("div");
            wEl.setAttribute("data-part", `L${i}W${wi}`);
            wEl.style.cssText = `position:absolute;left:${pct(seg.x0, w)};top:${pct(b.y0, h)};width:${pct(seg.x1 - seg.x0, w)};height:${pct(b.y1 - b.y0, h)};pointer-events:none;`;
            host.appendChild(wEl);
            register({
              id: `${writeId}:L${i}:W${wi}`,
              kind: "word",
              itemKey: itemKey ?? writeId,
              el: wEl,
              text: lineWords[wi] ?? lineText,
            });
          });
        });
        // Named diagram regions become real mark targets ("erd#Doctor") and
        // spatial-index entries, so the teacher can circle ONE entity.
        for (const part of parts ?? []) {
          const pEl = document.createElement("div");
          pEl.setAttribute("data-part", part.id);
          pEl.style.cssText = `position:absolute;left:${pct(part.x, w)};top:${pct(part.y, h)};width:${pct(part.w, w)};height:${pct(part.h, h)};pointer-events:none;`;
          host.appendChild(pEl);
          register({
            id: `${writeId}#${part.id}`,
            kind: "part",
            itemKey: itemKey ?? writeId,
            el: pEl,
            text: part.id,
          });
        }
        register({ id: writeId, kind: "equation", itemKey: itemKey ?? writeId, el: canvas, tex: markup });

        if (instant) {
          ctx.drawImage(img, 0, 0);
          return;
        }
        // Pen wipe: reveal each band left→right at a steady px/ms pace, but
        // never longer than ~900ms per band — a wide diagram band otherwise
        // drew for seconds while the voice moved on to the next sentence.
        const PX_PER_MS = 0.55;
        for (const b of bands) {
          const bw = b.x1 - b.x0;
          const pxPerMs = Math.max(PX_PER_MS, bw / 900);
          let revealed = 0;
          while (revealed < bw) {
            while (performer.paused()) await new Promise((r) => setTimeout(r, 150));
            await new Promise((r) => requestAnimationFrame(r));
            revealed = Math.min(bw, revealed + pxPerMs * 16);
            const sw = b.x0 + revealed;
            ctx.clearRect(0, b.y0, sw, b.y1 - b.y0);
            ctx.drawImage(img, 0, b.y0, sw, b.y1 - b.y0, 0, b.y0, sw, b.y1 - b.y0);
          }
          await new Promise((r) => setTimeout(r, 120));
        }
      } catch {
        setFailed(true);
      } finally {
        if (!instant && itemKey) signalDone(itemKey);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <pre className="mono whitespace-pre-wrap rounded-[3px] border border-line bg-paper-2 px-3 py-2 text-[13px] text-ink-2">
        {markup}
      </pre>
    );
  }
  return <div ref={hostRef} className="handwrite" data-eq-id={writeId} />;
}
