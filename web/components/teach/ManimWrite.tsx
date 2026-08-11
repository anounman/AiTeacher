"use client";

import { useEffect, useRef, useState } from "react";
import { signalDone } from "@/lib/teach/completion";
import { register } from "@/lib/teach/spatial";
import { performer } from "@/lib/teach/performer";
import type { TexResult } from "@/lib/teach/markup-to-tex";

// The Manim writer: a write action rendered as typeset math (MathTex) or text,
// drawn on stroke-by-stroke by Manim's Write() animation — the experiment in
// replacing mathwriter's handwriting.
//
// Trade-offs versus HandWrite, stated rather than hidden:
//   - No per-line bands or word boxes: the whole item registers as one region,
//     so a mark can circle the item but not one line inside it.
//   - Playback pace is the clip's own; pause maps to video.pause().
//   - Each item is a video element, not ink pixels — theme inversion applies
//     the same CSS filter the handwriting raster uses.

const cache = new Map<string, Promise<string | null>>();

function renderUrl(spec: TexResult, color: string, seconds: number): Promise<string | null> {
  const key = JSON.stringify([spec.tex, spec.heading, color, seconds]);
  const hit = cache.get(key);
  if (hit) return hit;
  const body = spec.heading
    ? { kind: "write_text", text: spec.tex, heading: true, seconds, color }
    : { kind: "write_math", tex: spec.tex, seconds, color };
  const request = fetch("/api/teach/clip-render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { id?: string };
      return data.id ? `/api/teach/clip/${data.id}` : null;
    })
    .catch(() => null);
  cache.set(key, request);
  return request;
}

export function ManimWrite({
  spec,
  writeId,
  color,
  itemKey,
  instant,
  onFallback,
}: {
  spec: TexResult;
  writeId: string;
  color: "ink" | "red" | "blue";
  itemKey?: string;
  instant?: boolean;
  // Render failed or timed out — the caller swaps back to mathwriter, so a
  // sidecar outage cannot blank the board.
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const key = itemKey ?? writeId;

  useEffect(() => {
    let alive = true;
    const seconds = spec.heading ? 1.6 : Math.min(4, 1.2 + spec.tex.length / 40);
    void renderUrl(spec, color, seconds).then((url) => {
      if (!alive) return;
      if (url) setSrc(url);
      else onFallback();
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Pause the pen when the lesson pauses.
  useEffect(() => {
    if (!src) return;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.ended) return;
      if (performer.paused()) {
        if (!video.paused) video.pause();
      } else if (video.paused) void video.play().catch(() => {});
    }, 150);
    return () => clearInterval(timer);
  }, [src]);

  if (!src) {
    return <div className="mono my-2 text-[11px] text-ink-3">writing…</div>;
  }
  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      autoPlay={!instant}
      preload="auto"
      className="handwrite-ink-raster"
      onEnded={() => signalDone(key)}
      onError={() => onFallback()}
      onLoadedData={(event) => {
        const video = event.currentTarget;
        register({ id: writeId, kind: "equation", itemKey: key, el: video, tex: spec.tex });
        if (instant && Number.isFinite(video.duration)) {
          video.currentTime = video.duration;
          signalDone(key);
        }
      }}
      // The clip is a 1280x720 frame with the content centred; scale it down
      // so an equation reads at board size rather than as a full-width video.
      style={{ maxWidth: spec.heading ? 520 : 620, width: "100%", display: "block", borderRadius: 2 }}
    />
  );
}
