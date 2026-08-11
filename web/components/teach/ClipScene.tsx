"use client";

import { useEffect, useRef, useState } from "react";
import { signalDone } from "@/lib/teach/completion";
import type { TeachAction } from "@/lib/teach/protocol";

type ClipAction = Extract<TeachAction, { type: "clip" }>;

// An animated clip on the board.
//
// The spec goes to the teacher service, which renders it with Manim and hands
// back a URL. Content-addressed, so a lesson that plays twice renders once,
// and the prefetch fired when the lesson finished generating usually means
// this is a cache hit by the time the pen reaches it.
//
// Failure is silent by design: no clip is better than an error card in the
// middle of a lesson, and everything the clip shows was also explained aloud.

const renderCache = new Map<string, Promise<string | null>>();

function specKey(action: ClipAction): string {
  return JSON.stringify([action.kind, action.expression, action.at, action.x_min, action.x_max, action.label]);
}

export function clipUrl(action: ClipAction): Promise<string | null> {
  const key = specKey(action);
  const hit = renderCache.get(key);
  if (hit) return hit;
  const request = fetch("/api/teach/clip-render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: action.kind,
      expression: action.expression,
      ...(action.at !== undefined ? { at: action.at } : {}),
      ...(action.x_min !== undefined ? { x_min: action.x_min } : {}),
      ...(action.x_max !== undefined ? { x_max: action.x_max } : {}),
      ...(action.label ? { label: action.label } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { id?: string };
      return data.id ? `/api/teach/clip/${data.id}` : null;
    })
    .catch(() => null);
  renderCache.set(key, request);
  return request;
}

export function ClipScene({
  action,
  itemKey,
  instant,
}: {
  action: ClipAction;
  itemKey: string;
  instant?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let alive = true;
    void clipUrl(action).then((url) => {
      if (!alive) return;
      if (url) setSrc(url);
      else {
        setFailed(true);
        // Release the beat: a clip that never arrives must not hold the lesson.
        signalDone(itemKey);
      }
    });
    return () => {
      alive = false;
    };
    // The action is fixed for the life of a board item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  if (failed) return null;
  if (!src) {
    return (
      <div className="mono my-4 text-[11px] text-ink-3" aria-live="polite">
        drawing the animation…
      </div>
    );
  }

  return (
    <figure className="my-5 flex flex-col gap-2">
      <video
        ref={videoRef}
        src={src}
        // A lesson has its own voice; a clip that carried audio would talk over
        // the teacher.
        muted
        playsInline
        autoPlay={!instant}
        // On reload the board is rebuilt without performing it, so a finished
        // lesson shows the clip's last frame rather than replaying everything.
        preload="auto"
        onEnded={() => signalDone(itemKey)}
        onError={() => {
          setFailed(true);
          signalDone(itemKey);
        }}
        onLoadedData={() => {
          if (instant) {
            const video = videoRef.current;
            // Park on the final frame: that is the state the rest of the
            // lesson refers back to.
            if (video && Number.isFinite(video.duration)) video.currentTime = video.duration;
            signalDone(itemKey);
          }
        }}
        style={{ maxWidth: "100%", borderRadius: 2 }}
      />
      {action.label && <figcaption className="mono text-[11px] text-ink-3">{action.label}</figcaption>}
    </figure>
  );
}
