"use client";

import { useEffect, useRef, useState } from "react";
import { signalDone } from "@/lib/teach/completion";
import { writeLabel } from "./HandWrite";
import { performer } from "@/lib/teach/performer";
import { register } from "@/lib/teach/spatial";

// A hand-drawn annotation over part of an earlier equation — the way a human
// teacher circles the denominator or underlines the term being discussed.
// Target syntax "eqId#partId": eqId = the latex action's id (data-eq-id on
// its container), partId = a \cssId{partId}{...} group inside that equation's
// MathJax SVG. Bare "eqId" marks the whole equation. The shape is a wobbly
// ellipse/underline/box (noise + overshoot) drawn stroke-wise; an optional
// label is written by the handwriting engine in the same color.

type MarkStyle = "circle" | "underline" | "box";
type MarkColor = "red" | "blue" | "ink";

const COLOR_VAR: Record<MarkColor, string> = {
  red: "var(--rule)",
  blue: "var(--feynman)",
  ink: "var(--ink-2)",
};

const rnd = (amp: number) => (Math.random() - 0.5) * 2 * amp;

function wobblyEllipse(cx: number, cy: number, rx: number, ry: number): string {
  const pts: [number, number][] = [];
  const start = -0.6 + rnd(0.3);
  const sweep = Math.PI * 2 * 1.09; // slight overshoot — loops past the start
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const t = start + (sweep * i) / n;
    const wob = 1 + rnd(0.045);
    pts.push([cx + rx * wob * Math.cos(t), cy + ry * wob * Math.sin(t)]);
  }
  return smooth(pts);
}

function wobblyLine(x0: number, x1: number, y: number): string {
  const pts: [number, number][] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    pts.push([x0 + ((x1 - x0) * i) / n + rnd(1.2), y + rnd(1.6)]);
  }
  return smooth(pts);
}

function wobblyBox(x: number, y: number, w: number, h: number): string {
  const corners: [number, number][] = [
    [x, y], [x + w, y], [x + w, y + h], [x, y + h], [x + rnd(3), y + rnd(3)],
  ];
  const pts: [number, number][] = [];
  for (let c = 0; c < corners.length - 1; c++) {
    const [ax, ay] = corners[c]!;
    const [bx, by] = corners[c + 1]!;
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      pts.push([ax + (bx - ax) * t + rnd(1.5), ay + (by - ay) * t + rnd(1.5)]);
    }
  }
  pts.push(corners[corners.length - 1]!);
  return smooth(pts);
}

// polyline → smooth path via quadratic midpoints
function smooth(pts: [number, number][]): string {
  if (pts.length < 3) return "";
  let d = `M ${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]!;
    const mx = (ax + pts[i + 1]![0]) / 2;
    const my = (ay + pts[i + 1]![1]) / 2;
    d += ` Q ${ax.toFixed(1)} ${ay.toFixed(1)}, ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  return d;
}

// Target forms: "eqId" (whole item), "eqId#part" (a named diagram region such
// as an ER entity box, or a MathJax \cssId group), "codeId:L2" (code line).
//
// Board ids are only unique within the lesson that wrote them — a second ER
// diagram is happily called "erd" again. A plain querySelector then returned
// the FIRST match, so re-explaining a new diagram drew every circle on the
// OLD one. Resolution order: the mark's own message first, then the most
// recent match on the board (never the oldest).
export function findTarget(
  target: string,
  itemKey?: string,
): { container: HTMLElement; el: Element } | null {
  let itemId = target;
  let namedPart: string | null = null;
  let linePart: string | null = null;
  if (target.includes("#")) {
    [itemId, namedPart] = target.split("#") as [string, string];
  } else {
    const m = /^(.*):(L\d+)$/.exec(target);
    if (m) {
      itemId = m[1]!;
      linePart = m[2]!;
    }
  }

  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-eq-id="${CSS.escape(itemId)}"]`));
  if (!all.length) return null;
  const msg = /^[a-z]+-(.+)-(?:\d+|ink-spacer)$/.exec(itemKey ?? "")?.[1];
  const sameMessage = msg
    ? all.filter((el) => el.closest(`[data-entry-key*="-${msg}-"]`))
    : [];
  const container = sameMessage.at(-1) ?? all.at(-1)!;

  if (linePart) {
    const line = container.querySelector(`[data-part="${linePart}"]`);
    return line ? { container, el: line } : null;
  }
  if (namedPart) {
    // Named diagram region (data-part) first, then a MathJax \cssId group.
    const part =
      container.querySelector(`[data-part="${CSS.escape(namedPart)}"]`) ??
      container.querySelector("svg")?.querySelector(`[id="${CSS.escape(namedPart)}"]`);
    return part ? { container, el: part } : null;
  }
  const svg = container.querySelector("svg");
  return { container, el: svg ?? container };
}

type Rect = { x: number; y: number; w: number; h: number };

const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Where to park an annotation label around `target` (container coordinates)
 * so it covers as little as possible of the diagram's own parts and of labels
 * already placed. Deterministic: right, above, below, then left.
 */
function freeSpotAround(
  container: HTMLElement,
  target: Rect,
  w: number,
  h: number,
): { x: number; y: number } {
  const cRect = container.getBoundingClientRect();
  const obstacles: Rect[] = [];
  container.querySelectorAll<HTMLElement>("[data-part], .mark-note").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const box = { x: r.left - cRect.left, y: r.top - cRect.top, w: r.width, h: r.height };
    // The marked element itself is not an obstacle for its own label.
    if (overlapArea(box, target) > target.w * target.h * 0.6) return;
    obstacles.push(box);
  });
  const candidates = [
    { x: target.x + target.w + 10, y: target.y + target.h / 2 - h / 2 },
    { x: target.x + target.w / 2 - w / 2, y: target.y - h - 6 },
    { x: target.x + target.w / 2 - w / 2, y: target.y + target.h + 6 },
    { x: target.x - w - 10, y: target.y + target.h / 2 - h / 2 },
  ];
  let best = candidates[0]!;
  let bestScore = Infinity;
  for (const c of candidates) {
    const box = { ...c, w, h };
    const score = obstacles.reduce((sum, o) => sum + overlapArea(box, o), 0);
    if (score < bestScore) {
      bestScore = score;
      best = c;
      if (score === 0) break;
    }
  }
  return best;
}

const waitFor = async <T,>(fn: () => T | null, tries: number, gapMs: number): Promise<T | null> => {
  for (let i = 0; i < tries; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return null;
};

export function MathMark({
  target,
  style,
  label,
  color,
  itemKey,
  instant = false,
}: {
  target: string;
  style: MarkStyle;
  label?: string;
  color: MarkColor;
  itemKey?: string;
  instant?: boolean;
}) {
  const labelRef = useRef<HTMLDivElement>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const labelHost = labelRef.current;
    if (!labelHost || labelHost.dataset.started) return;
    labelHost.dataset.started = "1";
    (async () => {
      try {
        // Equation may still be materializing (MathJax load) — poll.
        const found = await waitFor(() => findTarget(target, itemKey), instant ? 50 : 20, 300);
        if (!found) {
          setMissing(true);
          return;
        }
        const { container, el } = found;
        const cRect = container.getBoundingClientRect();
        const tRect = el.getBoundingClientRect();
        const x = tRect.left - cRect.left;
        const y = tRect.top - cRect.top;
        const stroke = COLOR_VAR[color];

        // Overlay svg spanning the container, drawn above the equation.
        container.style.position = "relative";
        const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        overlay.setAttribute("class", "math-mark-overlay");
        overlay.setAttribute("width", String(cRect.width));
        overlay.setAttribute("height", String(cRect.height));
        overlay.style.cssText =
          "position:absolute;left:0;top:0;overflow:visible;pointer-events:none;";
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const d =
          style === "underline"
            ? wobblyLine(x - 3, x + tRect.width + 3, y + tRect.height + 4)
            : style === "box"
              ? wobblyBox(x - 6, y - 5, tRect.width + 12, tRect.height + 10)
              : wobblyEllipse(
                  x + tRect.width / 2,
                  y + tRect.height / 2,
                  tRect.width / 2 + 10,
                  tRect.height / 2 + 8,
                );
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", stroke);
        path.setAttribute("stroke-width", "2.2");
        path.setAttribute("stroke-linecap", "round");
        overlay.appendChild(path);
        container.appendChild(overlay);

        if (!instant) {
          while (performer.paused()) await new Promise((r) => setTimeout(r, 150));
          const len = path.getTotalLength();
          path.style.strokeDasharray = String(len);
          path.style.strokeDashoffset = String(len);
          path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
            duration: 550,
            easing: "ease-in-out",
            fill: "forwards",
          });
          await new Promise((r) => setTimeout(r, 620));
        }

        if (label) {
          // The label belongs BESIDE the thing it names, like a teacher's
          // margin scribble — rendering it in the flow column stacked every
          // annotation into an unreadable list far from the diagram. Pick the
          // emptiest side so it doesn't land on the neighbouring entity.
          const spot = freeSpotAround(
            container,
            { x, y, w: tRect.width, h: tRect.height },
            Math.min(190, label.length * 7 + 12),
            18,
          );
          const note = document.createElement("div");
          note.className = "mark-note";
          note.style.cssText = `position:absolute;left:${spot.x}px;top:${spot.y}px;max-width:190px;color:${stroke};pointer-events:none;`;
          container.appendChild(note);
          register({
            id: `${itemKey ?? target}/label`,
            kind: "label",
            itemKey: itemKey ?? target,
            el: note,
            text: label,
          });
          try {
            await writeLabel(note, label, color);
          } catch {
            note.textContent = label;
            note.className = "mono text-[12px] italic";
          }
        }
      } finally {
        if (itemKey) signalDone(itemKey);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (missing && label) {
    // Target never appeared — at least show the label so the point isn't lost.
    return (
      <p className="mono pl-4 text-[12px] italic" style={{ color: COLOR_VAR[color] }}>
        ↖ {label}
      </p>
    );
  }
  return <div ref={labelRef} className="math-mark-label pl-6" />;
}
