"use client";

import { useEffect, useRef } from "react";

// The p5.js half of the writer experiment: text written character by
// character on a live canvas, with the writing SPEED adjustable while it
// plays. That live coupling is p5's one genuine advantage over a rendered
// clip — a video's pace is fixed at render time; this can chase the voice
// clock frame by frame.
//
// Its ceiling is equally visible here: p5 has no math typesetting. A fraction
// or an integral is beyond it without hand-building a layout engine — which
// is exactly the mathwriter/MathJax/Manim work it would be re-doing. So this
// component is honest about what it is: a handwriting-font text writer.

export function P5Write({
  text,
  heading = false,
  speed = 1,
  onDone,
}: {
  text: string;
  heading?: boolean;
  /** Characters per second multiplier, changeable live. */
  speed?: number;
  onDone?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let remove: (() => void) | undefined;

    void import("p5").then(({ default: P5 }) => {
      if (cancelled || !host) return;
      const ink =
        getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#1f2020";
      const size = heading ? 40 : 26;
      const done = { fired: false };

      const sketch = new P5((p: InstanceType<typeof P5>) => {
        let progress = 0; // characters revealed, fractional
        let width = 600;

        p.setup = () => {
          p.textFont("Caveat, cursive");
          p.textSize(size);
          const measure = p.createCanvas(10, 10);
          width = Math.min(760, Math.max(200, p.textWidth(text) + 40));
          measure.remove();
          p.createCanvas(width, size * 1.9).parent(host);
        };

        p.draw = () => {
          // 12 chars/sec base — near mathwriter's pen-wipe pace — times the
          // LIVE speed knob. Reading it every frame is the whole point.
          progress = Math.min(text.length, progress + (p.deltaTime / 1000) * 12 * speedRef.current);
          p.clear();
          p.fill(ink);
          p.noStroke();
          const visible = text.slice(0, Math.floor(progress));
          p.text(visible, 12, size * 1.2);
          // The pen: a dot riding the frontier of the written text.
          if (progress < text.length) {
            const x = 12 + p.textWidth(visible);
            p.circle(x + 2, size * 1.2 - size * 0.28, 3.5);
          } else if (!done.fired) {
            done.fired = true;
            p.noLoop();
            onDone?.();
          }
        };
      });
      remove = () => sketch.remove();
    });

    return () => {
      cancelled = true;
      remove?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, heading]);

  return <div ref={hostRef} style={{ lineHeight: 0 }} />;
}
