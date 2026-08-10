"use client";

import { useEffect, useRef } from "react";
import { getCachedLine, prefetchLine, replayInto, synthesizeLine } from "@/lib/teach/handwriting";
import { signalDone } from "@/lib/teach/completion";
import { performer } from "@/lib/teach/performer";
import { register } from "@/lib/teach/spatial";

const MAX_LINE_CHARS = 44;

export function toLines(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + w.length + 1 > MAX_LINE_CHARS) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

export function strokeOpts(heading: boolean) {
  return {
    widthPx: heading ? 700 : 860,
    heightPx: heading ? 150 : 130,
    bias: heading ? 1.2 : 0.9,
  };
}

// Real RNN handwriting. Live: replays pre-synthesized strokes with a writing
// cadence (pausable via performer). History (`instant`): cached lines render
// immediately; uncached lines fall back to plain text rather than stalling
// the engine queue behind a fresh lesson's prefetch. Every line registers in
// the spatial index.
export function StrokeText({
  text,
  heading = false,
  itemKey,
  instant = false,
}: {
  text: string;
  heading?: boolean;
  itemKey: string;
  instant?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.dataset.started) return;
    host.dataset.started = "1";
    (async () => {
      try {
        const lines = toLines(text);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const row = document.createElement("div");
          row.className = "stroke-row";
          host.appendChild(row);
          register({
            id: `${itemKey}/l${i}`,
            kind: heading ? "heading" : "textline",
            itemKey,
            el: row,
            text: line,
          });
          const plain = () => {
            row.textContent = line;
            row.className = heading
              ? "text-[1.15rem] font-bold text-ink"
              : "text-[0.95rem] italic text-ink-2";
          };
          try {
            if (instant) {
              const cached = getCachedLine(line, strokeOpts(heading));
              if (cached) await replayInto(row, await cached, { instant: true });
              else plain();
            } else {
              const tpl = await synthesizeLine(line, strokeOpts(heading));
              await replayInto(row, tpl, { paused: performer.paused });
            }
          } catch {
            plain();
          }
        }
      } finally {
        if (!instant) signalDone(itemKey);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      className={`stroke-text ${heading ? "max-w-[420px]" : "max-w-[560px]"}`}
    />
  );
}

export function prefetchStrokeText(text: string, heading: boolean): void {
  for (const line of toLines(text)) prefetchLine(line, strokeOpts(heading));
}
