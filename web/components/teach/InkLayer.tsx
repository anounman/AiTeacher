"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { register, unregister } from "@/lib/teach/spatial";

// Student ink: freehand pen strokes drawn straight onto the board in world
// coordinates. Apple Pencil, mouse, and touch all arrive as pointer events —
// pressure (when the device reports it) modulates stroke width via
// perfect-freehand, which turns the raw polyline into a pressure-shaped
// outline (the GoodNotes-quality ink the raw SVG polyline never had).
// Every stroke registers in the spatial index so marquee selection and
// vision reading can resolve "the thing the student drew". Session-only for
// now (persistence is TODO 3.2 alongside the rest of the board).

export interface InkStroke {
  id: string;
  color: string; // resolved css color
  points: { x: number; y: number; p: number }[]; // world coords + pressure
}

export type InkColor = "ink" | "red" | "blue";

const COLOR_VAR: Record<InkColor, string> = {
  ink: "var(--ink)",
  red: "var(--rule)",
  blue: "var(--feynman)",
};

let strokeSeq = 0;

export function useInk(toWorld: (x: number, y: number) => { x: number; y: number }) {
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [drawing, setDrawing] = useState(false);
  const activeRef = useRef<InkStroke | null>(null);

  // Starts a stroke and returns its id so gesture code can cancel it (e.g.
  // a second finger landing means "that was a pan, not writing").
  const start = useCallback(
    (e: React.PointerEvent, color: InkColor): string => {
      const { x, y } = toWorld(e.clientX, e.clientY);
      const stroke: InkStroke = {
        id: `ink-${++strokeSeq}`,
        color: COLOR_VAR[color],
        points: [{ x, y, p: e.pressure || 0.5 }],
      };
      activeRef.current = stroke;
      setStrokes((s) => [...s, stroke]);
      setDrawing(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const pointerId = e.pointerId;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const a = activeRef.current;
        if (a?.id !== stroke.id) return;
        // Coalesced events keep fast pencil strokes smooth instead of angular.
        const samples = "getCoalescedEvents" in ev ? ev.getCoalescedEvents() : [ev];
        for (const s of samples.length ? samples : [ev]) {
          const w = toWorld(s.clientX, s.clientY);
          const last = a.points[a.points.length - 1]!;
          if (Math.hypot(w.x - last.x, w.y - last.y) < 0.8) continue;
          a.points.push({ x: w.x, y: w.y, p: s.pressure || 0.5 });
        }
        setStrokes((s) => [...s]); // repaint (points array is mutated in place)
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (activeRef.current?.id === stroke.id) activeRef.current = null;
        setDrawing(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return stroke.id;
    },
    [toWorld],
  );

  // A second finger landed: the first touch was a pan, not writing.
  const cancel = useCallback((id: string) => {
    if (activeRef.current?.id === id) activeRef.current = null;
    setStrokes((s) => s.filter((st) => st.id !== id));
    unregister(id);
    setDrawing(false);
  }, []);

  // Eraser: remove any stroke with a point within `r` world units.
  const eraseAt = useCallback((x: number, y: number, r: number) => {
    setStrokes((s) =>
      s.filter((st) => {
        const hit = st.points.some((p) => Math.hypot(p.x - x, p.y - y) <= r);
        if (hit) unregister(st.id);
        return !hit;
      }),
    );
  }, []);

  const undo = useCallback(
    () =>
      setStrokes((s) => {
        const last = s[s.length - 1];
        if (last) unregister(last.id);
        return s.slice(0, -1);
      }),
    [],
  );
  const clear = useCallback(() => setStrokes([]), []);

  return { strokes, drawing, start, cancel, eraseAt, undo, clear };
}

// perfect-freehand outline → SVG path (closed polygon, filled).
function outlinePath(stroke: InkStroke): string {
  const outline = getStroke(
    stroke.points.map((p) => [p.x, p.y, p.p]),
    { size: 3.2, thinning: 0.55, smoothing: 0.55, streamline: 0.45, simulatePressure: false },
  );
  if (!outline.length) return "";
  let d = `M ${outline[0]![0]!.toFixed(2)} ${outline[0]![1]!.toFixed(2)}`;
  for (let i = 1; i < outline.length; i++) {
    d += ` L ${outline[i]![0]!.toFixed(2)} ${outline[i]![1]!.toFixed(2)}`;
  }
  return d + " Z";
}

function StrokePath({ stroke }: { stroke: InkStroke }) {
  // Register once, with the live path element, so BVH queries see the ink.
  const refCb = useCallback(
    (el: SVGPathElement | null) => {
      if (el) {
        register({
          id: stroke.id,
          kind: "ink",
          itemKey: stroke.id,
          el,
          text: `${stroke.points.length} points`,
        });
      }
    },
    [stroke.id, stroke.points.length],
  );
  return <path ref={refCb} d={outlinePath(stroke)} fill={stroke.color} stroke="none" />;
}

// Rendered inside .teach-world so strokes live in world coordinates and
// pan/zoom with the board.
export function InkLayer({ strokes }: { strokes: InkStroke[] }) {
  return (
    <svg className="ink-layer" aria-hidden>
      {strokes.map((s) => (
        <StrokePath key={s.id} stroke={s} />
      ))}
    </svg>
  );
}

export function useInkIdleNudge(strokes: InkStroke[], onIdle: () => void, ms = 2500) {
  // After the student stops drawing for `ms`, fire once (used to hint they
  // can ask about their drawing). Cheap, cancellable.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = strokes.length;
  useEffect(() => {
    if (!count) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onIdle, ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [count, onIdle, ms]);
}
