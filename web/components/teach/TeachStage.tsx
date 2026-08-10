"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board, type BoardEntry } from "./Board";
import { loadEngine } from "@/lib/teach/handwriting";
import { prefetchStrokeText } from "./StrokeText";
import { prefetchWrite, writeReady } from "./HandWrite";
import { loadMathJax } from "./MathWriteOn";
import { findTarget as findMarkTarget } from "./MathMark";
import { waitForDone } from "@/lib/teach/completion";
import { performer, type PerformerStatus } from "@/lib/teach/performer";
import { describeHits, queryRegion } from "@/lib/teach/spatial";
import { type DrawCue } from "@/lib/teach/timeline";
import { planLessonTimeline } from "@/lib/teach/timeline-client";
import { segmentEventIndex } from "@/lib/teach/visual-lesson";
import { visualPlanSchema, type VisualPlan } from "@/lib/teach/visual-schema";
import { MAX_ZOOM, MIN_ZOOM, useCanvas } from "@/lib/teach/canvas";
import { shouldBlockTouchNavigation } from "@/lib/teach/input-arbitration";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { InkLayer, useInk, type InkColor } from "./InkLayer";
import { captureInk } from "@/lib/teach/ink-capture";
import { repairBoard } from "@/lib/teach/repair";
import { cancelSpeech, prefetchSpeech, probeTts, setVoice, speak as ttsSpeak } from "@/lib/teach/tts";
import {
  audioUploadName,
  microphoneErrorMessage,
  preferredRecorderMimeType,
} from "@/lib/voice/recording";
import {
  parseTeachEvents,
  speakable,
  toTranscriptParts,
  type TeachAction,
  type TeachEvent,
} from "@/lib/teach/protocol";
import type { Message } from "@/lib/db/schema";
import type { ReactNode } from "react";

// Per-action ceilings — board items signal their own completion; these only
// stop a lost signal from wedging the lesson.
function actionTimeoutMs(action: TeachAction): number {
  switch (action.type) {
    case "latex":
      return Math.min(12_000, 2_000 + action.tex.length * 60);
    case "mark":
      return Math.min(20_000, 8_000 + (action.label?.length ?? 5) * 250);
    case "text":
    case "heading":
      return Math.min(30_000, 4_000 + action.text.length * 250);
    case "code":
      return Math.min(20_000, 2_000 + action.code.length * 15);
    case "write":
      return Math.min(30_000, 4_000 + action.markup.length * 40);
    default:
      return 800;
  }
}

const AWAITED = new Set(["latex", "text", "heading", "mark", "code", "write"]);
const VOICED_SETTLE_MS = 1_100;
const SILENT_SETTLE_MS = 1_600;

type DirectorSource = "model" | "fallback";
type DirectorStatus = "idle" | "planning" | DirectorSource | "unavailable";
type DirectedScene = {
  messageId: string;
  plan: VisualPlan;
  source: DirectorSource;
  targetEventIndex: number;
  eventCount: number;
  shown: boolean;
};

type DirectorResponse = {
  plan: unknown;
  source: DirectorSource;
};

// StrictMode and rapid stage remounts must not launch the same cold local
// model twice. The request is non-blocking and the endpoint persists its
// result, so it is safe for this session cache to outlive a component mount.
const visualRequests = new Map<string, Promise<DirectorResponse>>();

function requestVisualDirection(messageId: string, lessonMd: string): Promise<DirectorResponse> {
  const hit = visualRequests.get(messageId);
  if (hit) return hit;
  const request = fetch("/api/teach/visualize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonMd, lessonId: messageId, messageId }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`visual director ${response.status}`);
    return (await response.json()) as DirectorResponse;
  });
  visualRequests.set(messageId, request);
  request.catch(() => visualRequests.delete(messageId));
  return request;
}

// A pause-aware monotonic wait for timeline cues. Short polling keeps pause,
// interruption, and speech-finished cancellation responsive without letting
// wall-clock time advance while the student has stopped the lesson.
async function waitForActiveMs(
  durationMs: number,
  paused: () => boolean,
  cancelled: () => boolean,
  stopEarly: () => boolean = () => false,
): Promise<boolean> {
  let elapsed = 0;
  let previous = performance.now();
  while (elapsed < durationMs) {
    if (cancelled() || stopEarly()) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, durationMs - elapsed)));
    const now = performance.now();
    if (!paused()) elapsed += now - previous;
    previous = now;
  }
  return !cancelled() && !stopEarly();
}

function describeAction(a: TeachAction): string {
  switch (a.type) {
    case "write":
      return `handwriting ${a.id ?? ""} (${a.markup.slice(0, 40)}…)`;
    case "latex":
      return `equation ${a.id ?? a.tex.slice(0, 30)}`;
    case "mark":
      return `mark on ${a.target}${a.label ? ` ("${a.label}")` : ""}`;
    case "code":
      return `code block ${a.id ?? ""}`;
    case "heading":
      return `heading "${a.text}"`;
    case "text":
      return `note "${a.text}"`;
    default:
      return a.type;
  }
}

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden>
      {name}
    </span>
  );
}

// The teaching stage: an infinite paper canvas filling the viewport, with
// every control floating above it as a frosted overlay
// (design/live-lesson-stitch.png). Owns the lesson performance pump —
// plan-then-perform, pausable, cursor-resumable (ARCHITECTURE §8).
export function TeachStage({
  conversationId,
  baseMd,
  liveMd,
  liveKey,
  streaming,
  messages,
  title,
  projectName,
  onSend,
  onStop,
  error,
  onRetry,
  onExit,
  personaControl,
  transcriptionAvailable = false,
}: {
  conversationId: string;
  baseMd: string;
  liveMd: string;
  liveKey: string | null;
  streaming: boolean;
  messages: Message[];
  title: string;
  projectName?: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  error?: string | null;
  onRetry?: () => void;
  onExit: () => void;
  personaControl?: ReactNode;
  transcriptionAvailable?: boolean;
}) {
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [liveEntries, setLiveEntries] = useState<BoardEntry[]>([]);
  const [directedScenes, setDirectedScenes] = useState<DirectedScene[]>([]);
  const [directorStatus, setDirectorStatus] = useState<DirectorStatus>("idle");
  const [draft, setDraft] = useState("");

  const [penMode, setPenMode] = useState(false);
  const [penColor, setPenColor] = useState<InkColor>("red");
  const [eraserMode, setEraserMode] = useState(false);
  const {
    vp: canvasVp,
    transformRef,
    surfaceRef: canvasSurfaceRef,
    onInit: onCanvasInit,
    onTransform: onCanvasTransform,
    beginGesture: beginCanvasGesture,
    endGesture: endCanvasGesture,
    panning: canvasPanning,
    following: cameraFollowing,
    setFollowing: setCameraFollowing,
    zoomBy: zoomCanvasBy,
    reset: resetCanvas,
    focus: focusCanvas,
  } = useCanvas();
  const worldRef = useRef<HTMLDivElement>(null);
  const transcriptBodyRef = useRef<HTMLDivElement>(null);
  const [performerStatus, setPerformerStatus] = useState<PerformerStatus>(() => performer.status());

  // On iPad the transcript remains one tap away, but the notebook opens with
  // the full writing surface instead of covering almost half the page.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 1199px)").matches) return;
    queueMicrotask(() => setTranscriptOpen(false));
  }, []);

  const cameraInsets = useMemo(
    () => ({ top: 150, right: transcriptOpen ? 360 : 28, bottom: 140, left: 24 }),
    [transcriptOpen],
  );
  const focusBoard = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, force = false) =>
      focusCanvas(rect, { force, insets: cameraInsets }),
    [cameraInsets, focusCanvas],
  );


  // Repair loop: geometry, not vision — every element's position is measured,
  // so overlaps are exact math (lib/teach/repair.ts). Runs on a slow beat
  // while content is landing (handwriting PNGs arrive async) and settles with
  // a final pass; idempotent, so the cadence is free.
  const repairNow = useCallback(() => {
    const world = worldRef.current;
    if (world) repairBoard(world, canvasVp.k || 1);
  }, [canvasVp.k]);
  useEffect(() => {
    const interval = setInterval(repairNow, 900);
    repairNow();
    return () => clearInterval(interval);
  }, [repairNow]);

  // Screen → world: the world div's bounding rect carries the current
  // translate, its scale is vp.k.
  const screenToWorld = useCallback(
    (r: { x: number; y: number; w: number; h: number }) => {
      const w = worldRef.current?.getBoundingClientRect();
      const k = canvasVp.k || 1;
      if (!w) return r;
      return { x: (r.x - w.left) / k, y: (r.y - w.top) / k, w: r.w / k, h: r.h / k };
    },
    [canvasVp.k],
  );
  const measureEl = useCallback(
    (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return screenToWorld({ x: r.left, y: r.top, w: r.width, h: r.height });
    },
    [screenToWorld],
  );

  const pointToWorld = useCallback(
    (x: number, y: number) => {
      const p = screenToWorld({ x, y, w: 0, h: 0 });
      return { x: p.x, y: p.y };
    },
    [screenToWorld],
  );

  // Follow camera, fixed: the newest board item mounts EMPTY (its handwriting
  // PNG lands async), so a one-shot focus aimed at a zero-height rect and the
  // writing then grew below the frame — "the camera doesn't follow". Observe
  // the newest item and re-aim on every size change until the next item takes
  // over; focus() dedupes sub-24px moves, so quiet frames cost nothing.
  const growObserverRef = useRef<ResizeObserver | null>(null);
  const onBoardGrow = useCallback(
    (el: HTMLElement) => {
      growObserverRef.current?.disconnect();
      // A mark aims the camera at what it POINTS AT (handled where the cue is
      // launched), never at its own near-empty label host — otherwise
      // "let me point at the diagram" panned to a blank spot below it.
      if (el.classList.contains("board-item-mark")) return;
      const aim = () => {
        const rect = measureEl(el);
        if (rect.w > 2 || rect.h > 2) focusBoard(rect);
      };
      aim();
      const observer = new ResizeObserver(aim);
      observer.observe(el);
      growObserverRef.current = observer;
    },
    [focusBoard, measureEl],
  );
  useEffect(() => () => growObserverRef.current?.disconnect(), []);
  const ink = useInk(pointToWorld);
  const inkStrokesRef = useRef(ink.strokes);
  inkStrokesRef.current = ink.strokes;
  const [checkingInk, setCheckingInk] = useState(false);
  // No warm-up needed: the `read` slot is a cloud vision model, always
  // resident — reads return in a couple of seconds from the first stroke.

  // GoodNotes input model. react-zoom-pan-pinch owns navigation; this small
  // pointer arbiter owns ink. Pencil always writes. In pen mode one finger
  // writes, while a second finger cancels the young stroke and the open-source
  // gesture engine takes over with a bounded pan/pinch.
  const touchGesture = useRef<{
    pointers: Set<number>;
    strokeId: string | null;
    navigating: boolean;
  }>({ pointers: new Set(), strokeId: null, navigating: false });
  const pencilActiveRef = useRef(false);
  const [inkNavigationBlocked, setInkNavigationBlocked] = useState(false);
  const erasePointerRef = useRef<number | null>(null);

  useEffect(() => {
    const surface = canvasSurfaceRef.current;
    if (!surface) return;

    // RZPP registers native bubble-phase TouchEvent listeners. A native,
    // non-passive capture listener is the reliable place to keep Safari's
    // duplicate stylus stream away from the camera while PointerEvents ink.
    const stopTouchNavigation = (native: TouchEvent) => {
      const currentTouches = Array.from(native.touches) as Array<Touch & { touchType?: string }>;
      const changedTouches = Array.from(native.changedTouches) as Array<Touch & { touchType?: string }>;
      const block = shouldBlockTouchNavigation({
        penMode,
        pencilPointerActive: pencilActiveRef.current,
        activeInkStroke: !!touchGesture.current.strokeId || erasePointerRef.current !== null,
        navigationGestureActive: touchGesture.current.navigating,
        touchCount: currentTouches.length,
        touchTypes: [...currentTouches, ...changedTouches]
          .map((touch) => touch.touchType ?? "")
          .filter(Boolean),
      });
      if (!block) return;
      if (native.cancelable) native.preventDefault();
      native.stopImmediatePropagation();
    };

    const options: AddEventListenerOptions = { capture: true, passive: false };
    surface.addEventListener("touchstart", stopTouchNavigation, options);
    surface.addEventListener("touchmove", stopTouchNavigation, options);
    surface.addEventListener("touchend", stopTouchNavigation, options);
    surface.addEventListener("touchcancel", stopTouchNavigation, options);
    return () => {
      surface.removeEventListener("touchstart", stopTouchNavigation, options);
      surface.removeEventListener("touchmove", stopTouchNavigation, options);
      surface.removeEventListener("touchend", stopTouchNavigation, options);
      surface.removeEventListener("touchcancel", stopTouchNavigation, options);
    };
  }, [canvasSurfaceRef, penMode]);

  const eraseFrom = useCallback(
    (e: React.PointerEvent) => {
      erasePointerRef.current = e.pointerId;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        if (erasePointerRef.current !== ev.pointerId) return;
        const w = pointToWorld(ev.clientX, ev.clientY);
        ink.eraseAt(w.x, w.y, 14 / (canvasVp.k || 1));
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        erasePointerRef.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      move(e.nativeEvent);
    },
    [pointToWorld, ink, canvasVp.k],
  );

  const onSurfacePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (selectMode) return;
      const g = touchGesture.current;

      // The pencil is a pen wherever it lands.
      if (e.pointerType === "pen" || (penMode && e.pointerType === "mouse")) {
        e.preventDefault();
        e.stopPropagation();
        pencilActiveRef.current = e.pointerType === "pen";
        setInkNavigationBlocked(true);
        if (eraserMode) eraseFrom(e);
        else ink.start(e, penColor);
        return;
      }

      if (e.pointerType === "touch") {
        g.pointers.add(e.pointerId);
        if (g.pointers.size >= 2) {
          if (g.strokeId) ink.cancel(g.strokeId);
          g.strokeId = null;
          g.navigating = true;
          erasePointerRef.current = null;
          setInkNavigationBlocked(false);
          return;
        }

        if (penMode) {
          g.navigating = false;
          setInkNavigationBlocked(true);
          if (eraserMode) eraseFrom(e);
          else g.strokeId = ink.start(e, penColor);
        }
      }
    },
    [selectMode, penMode, eraserMode, penColor, ink, eraseFrom],
  );

  const onSurfacePointerEnd = useCallback((e: React.PointerEvent) => {
    const gesture = touchGesture.current;
    gesture.pointers.delete(e.pointerId);
    if (gesture.pointers.size === 0) {
      gesture.strokeId = null;
      gesture.navigating = false;
      setInkNavigationBlocked(false);
    }
    if (e.pointerType === "pen") {
      pencilActiveRef.current = false;
      setInkNavigationBlocked(false);
    }
    if (erasePointerRef.current === e.pointerId) erasePointerRef.current = null;
  }, []);

  // "Check my work": rasterize the pen strokes, have the parse slot's vision
  // model read them, then hand the transcription to the normal interruption
  // flow — the reason model (which holds the lesson) judges the answer and
  // speaks back (Phase 4.1 ask-pen).
  const checkInkAnswer = useCallback(async () => {
    if (checkingInk || !ink.strokes.length) return;
    const capture = captureInk(ink.strokes);
    if (!capture) return;
    setCheckingInk(true);
    try {
      // What board items the writing sits next to — so the tutor knows which
      // question the ink answers. World box → viewport rect for the BVH.
      const w = worldRef.current?.getBoundingClientRect();
      const k = canvasVp.k || 1;
      let near: string | null = null;
      if (w) {
        near = describeHits(
          queryRegion({
            x: capture.box.x * k + w.left,
            y: capture.box.y * k + w.top,
            w: capture.box.w * k,
            h: capture.box.h * k,
          }).filter((hit) => hit.kind !== "ink"),
          3,
        );
      }
      const res = await fetch("/api/teach/read-ink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ png: capture.dataUrl, context: near ?? undefined }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        onSend("I wrote my answer on the board with the pen, but it couldn't be read. Ask me to write it more clearly or say it out loud.");
        return;
      }
      onSend(
        `I wrote this on the board with my pen${near ? ` (next to ${near})` : ""}: "${data.text}". Check my work — tell me if it's right, and if not, where I went wrong.`,
      );
    } catch {
      /* interruption flow surfaces nothing worse than a lost tap */
    } finally {
      setCheckingInk(false);
    }
  }, [checkingInk, ink.strokes, canvasVp.k, onSend]);

  const [voices, setVoices] = useState<string[]>([]);
  const [voice, setVoiceState] = useState<string>("");

  useEffect(() => {
    void loadEngine();
    void loadMathJax().catch(() => {});
    void probeTts().then((d) => {
      setVoices(d.voices);
      if (d.available && d.voices.length) {
        const initial =
          (typeof localStorage !== "undefined" && localStorage.getItem("teach.voice")) || "";
        const pick = d.voices.includes(initial) ? initial : (d as { voice?: string }).voice ?? d.voices[0]!;
        setVoice(pick);
        setVoiceState(pick);
      }
    });
  }, []);

  useEffect(() => performer.subscribeSelection(setSelection), []);
  useEffect(() => performer.subscribeStatus(setPerformerStatus), []);

  // The transcript follows the same event cursor that drives voice playback
  // and board drawing. Scroll only the sidebar, never the canvas/page.
  useEffect(() => {
    if (!transcriptOpen || performerStatus.activeEventIndex === null) return;
    const frame = requestAnimationFrame(() => {
      const body = transcriptBodyRef.current;
      const active = body?.querySelector<HTMLElement>(".transcript-part.is-current");
      if (!body || !active) return;
      const bodyRect = body.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const top =
        body.scrollTop +
        activeRect.top -
        bodyRect.top -
        (body.clientHeight - activeRect.height) / 2;
      body.scrollTo({
        top: Math.max(0, top),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [performerStatus.activeEventIndex, performerStatus.activeId, transcriptOpen, messages.length]);

  // History entries are built per message (not from concatenated markdown) so
  // each board item stays traceable to its transcript turn — that mapping is
  // what "click a transcript bubble → camera jumps to that part of the board"
  // navigates with.
  const baseEntries = useMemo<BoardEntry[]>(
    () =>
      messages
        .filter((m) => m.role === "assistant" && m.id !== liveKey)
        .flatMap((m) =>
          parseTeachEvents(m.content, true)
            .filter((e): e is Extract<TeachEvent, { kind: "draw" }> => e.kind === "draw")
            .map((e, i) => ({ action: e.action, key: `b-${m.id}-${i}`, live: false })),
        ),
    [messages, liveKey],
  );

  // Go back to the part of the board a transcript turn wrote.
  const jumpToMessage = useCallback(
    (messageId: string) => {
      const el = document.querySelector<HTMLElement>(
        `[data-entry-key^="b-${messageId}-"], [data-entry-key^="l-${messageId}-"]`,
      );
      if (el) focusBoard(measureEl(el), true);
    },
    [focusBoard, measureEl],
  );

  const events = useMemo(() => parseTeachEvents(liveMd, !streaming), [liveMd, streaming]);
  const streamedReplyPreview = useMemo(
    () =>
      events
        .filter((event): event is Extract<TeachEvent, { kind: "speak" }> => event.kind === "speak")
        .slice(-2)
        .map((event) => event.text)
        .join(" "),
    [events],
  );

  // Prefetch each new item's assets while the plan is still streaming.
  const prefetchedRef = useRef(0);
  useEffect(() => {
    for (let i = prefetchedRef.current; i < events.length; i++) {
      const e = events[i]!;
      if (e.kind === "speak") {
        prefetchSpeech(speakable(e.text));
        continue;
      }
      if (e.action.type === "write") {
        prefetchWrite(e.action.markup, e.action.color);
      } else if (e.action.type === "mark" && e.action.label) {
        prefetchWrite(e.action.label, e.action.color);
      } else if (e.action.type === "text" || e.action.type === "heading") {
        prefetchStrokeText(e.action.text, e.action.type === "heading");
      }
    }
    prefetchedRef.current = events.length;
  }, [events]);

  const pumpingRef = useRef(false);
  const liveKeyRef = useRef(liveKey);
  liveKeyRef.current = liveKey;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    setLiveEntries([]);
    prefetchedRef.current = 0;
    cancelSpeech();
    setDirectorStatus("idle");
  }, [liveKey]);

  // The visual model runs beside playback, never in front of it. Its local
  // cold start can be ~24s, so the normal speech/pen timeline starts
  // immediately and a validated scene joins at its transcript cue when ready.
  useEffect(() => {
    if (streaming || !liveKey || !liveMd.trim()) return;
    // The director exists to add a visual to a lesson that has none. When the
    // lesson already drew by hand ([G]/[DRAW] in any write action) a directed
    // scene can only echo the board as a boxed flowchart — duplicate content
    // that reads as clutter/overlap. Skip directing entirely.
    if (
      events.some(
        (event) =>
          event.kind === "draw" &&
          (event.action.type === "visual_scene" ||
            (event.action.type === "write" && /\[(?:DRAW|G)\]/.test(event.action.markup))),
      )
    )
      return;
    const myKey = liveKey;
    const eventSnapshot = events;
    queueMicrotask(() => {
      if (liveKeyRef.current === myKey) setDirectorStatus("planning");
    });
    void requestVisualDirection(myKey, liveMd)
      .then((response) => {
        const parsed = visualPlanSchema.safeParse(response.plan);
        if (!parsed.success) throw new Error("invalid visual plan response");
        const cueIndexes = parsed.data.actions
          .map((action) => segmentEventIndex(eventSnapshot, action.cue?.segmentId))
          .filter((index): index is number => index !== null);
        const firstSpeech = eventSnapshot.findIndex((event) => event.kind === "speak");
        const targetEventIndex = cueIndexes.length
          ? Math.min(...cueIndexes)
          : Math.max(0, firstSpeech);
        // The deterministic fallback only restates board elements the lesson
        // already wrote by hand — since the writing engine draws real diagrams
        // ([G]/[DRAW]), that card is redundant chrome. Only a real model plan
        // earns a scene; otherwise the board stands on its own.
        if (response.source !== "model") {
          if (liveKeyRef.current === myKey) setDirectorStatus(response.source);
          return;
        }
        setDirectedScenes((scenes) =>
          scenes.some((scene) => scene.messageId === myKey)
            ? scenes
            : [
                ...scenes,
                {
                  messageId: myKey,
                  plan: parsed.data,
                  source: response.source,
                  targetEventIndex,
                  eventCount: eventSnapshot.length,
                  shown: false,
                },
              ],
        );
        if (liveKeyRef.current === myKey) setDirectorStatus(response.source);
      })
      .catch(() => {
        if (liveKeyRef.current === myKey) setDirectorStatus("unavailable");
      });
  }, [streaming, liveKey, liveMd, events]);

  // The scene and transcript cue listen to the same performer cursor as TTS.
  // If the model answers late, progress makes it appear immediately instead
  // of rewinding or pausing the lesson.
  useEffect(() => {
    const ready = directedScenes.filter((scene) => {
      if (scene.shown) return false;
      if (
        performerStatus.activeId === scene.messageId &&
        performerStatus.activeEventIndex !== null &&
        performerStatus.activeEventIndex >= scene.targetEventIndex
      ) return true;
      return performer.getProgress(scene.messageId) > scene.targetEventIndex;
    });
    if (!ready.length) return;
    const ids = new Set(ready.map((scene) => scene.messageId));
    queueMicrotask(() => {
      setDirectedScenes((scenes) =>
        scenes.map((scene) => (ids.has(scene.messageId) ? { ...scene, shown: true } : scene)),
      );
    });
  }, [directedScenes, performerStatus]);

  // Resolves false when the segment was cut short by a pause — the pump
  // retries it (Kokoro resumes in place; the browser fallback re-speaks).
  const speak = useCallback(
    (text: string) => ttsSpeak(speakable(text), mutedRef.current),
    [],
  );

  const planReady = !streaming && events.length > 0 && !!liveKey;
  const [performing, setPerforming] = useState(false);

  useEffect(() => {
    if (!planReady || pumpingRef.current) return;
    const myKey = liveKey!;
    if (performer.getProgress(myKey) >= eventsRef.current.length) return;
    pumpingRef.current = true;
    setPerforming(true);
    (async () => {
      try {
        // Answer to a marked question? Its writing anchors beside the mark
        // and the camera returns there first.
        const anchor = performer.anchorFor(myKey);
        if (anchor) focusBoard(anchor, true);

        let cursor = performer.getProgress(myKey);
        if (cursor > 0) {
          // Everything delivered before an interruption reappears instantly.
          setLiveEntries(
            eventsRef.current
              .slice(0, cursor)
              .map((e, i) => ({ e, i }))
              .filter(
                (x): x is { e: Extract<TeachEvent, { kind: "draw" }>; i: number } =>
                  x.e.kind === "draw",
              )
              .map((x) => ({ action: x.e.action, key: `l-${myKey}-${x.i}`, live: false, anchor })),
          );
        }
        performer.begin(myKey, eventsRef.current.length, cursor);

        // Ink-aware placement: flow items know nothing about the student's
        // absolutely-positioned pen strokes, so a reply used to write straight
        // over them (the check-my-work pileup). Measure both and open exactly
        // enough vertical clearance for the new writing to start below the ink.
        if (cursor === 0 && !anchor && inkStrokesRef.current.length) {
          const world = worldRef.current;
          const wRect = world?.getBoundingClientRect();
          if (world && wRect) {
            const k = world.offsetWidth ? wRect.width / world.offsetWidth : 1;
            let contentBottom = 0;
            world.querySelectorAll<HTMLElement>(".board-section .board-item").forEach((el) => {
              contentBottom = Math.max(contentBottom, (el.getBoundingClientRect().bottom - wRect.top) / k);
            });
            let inkBottom = 0;
            for (const stroke of inkStrokesRef.current) {
              for (const p of stroke.points) inkBottom = Math.max(inkBottom, p.y);
            }
            const clearance = Math.ceil(inkBottom - contentBottom + 28);
            if (inkBottom > contentBottom - 10 && clearance > 0) {
              const key = `l-${myKey}-ink-spacer`;
              setLiveEntries((entries) =>
                entries.some((entry) => entry.key === key)
                  ? entries
                  : [...entries, { action: { type: "spacer", h: clearance }, key, live: false }],
              );
            }
          }
        }

        const superseded = () => liveKeyRef.current !== myKey;
        const waitUnpaused = async () => {
          while (performer.paused() && !superseded()) await new Promise((r) => setTimeout(r, 150));
        };

        // The pure timeline spreads visual cues across their narration. The
        // voice remains the authoritative clock when present; slow renderers
        // get a short settle window instead of holding the next sentence for
        // their full worst-case timeout.
        const timeline = await planLessonTimeline(eventsRef.current, cursor);
        for (const beat of timeline) {
          if (superseded()) return;
          await waitUnpaused();
          performer.activate(myKey, beat.from);

          let speechFinished = false;
          const launched = new Set<number>();
          const completions: Promise<void>[] = [];

          const launchDraw = (cue: DrawCue) => {
            if (launched.has(cue.eventIndex) || superseded()) return;
            launched.add(cue.eventIndex);
            if (beat.speech.length === 0) performer.activate(myKey, cue.eventIndex);
            const action = cue.event.action;
            const key = `l-${myKey}-${cue.eventIndex}`;
            setLiveEntries((entries) => {
              if (entries.some((entry) => entry.key === key)) return entries;
              return [...entries, { action, key, live: true, anchor }];
            });
            // Pointing at earlier work: bring the camera to the thing being
            // marked (it can be far above the newest writing) as soon as the
            // target resolves, so the student sees the circle being drawn.
            if (action.type === "mark") {
              void (async () => {
                for (let i = 0; i < 20 && !superseded(); i++) {
                  const found = findMarkTarget(action.target, key);
                  if (found) {
                    focusBoard(measureEl(found.el as HTMLElement));
                    return;
                  }
                  await new Promise((r) => setTimeout(r, 150));
                }
              })();
            }
            if (AWAITED.has(action.type)) {
              completions.push(waitForDone(key, actionTimeoutMs(action)));
            }
          };

          const speechTask = (async () => {
            // Pen/voice sync gate: hold the first word until the handwriting
            // this beat narrates is rendered and cached (bounded — a slow or
            // failed render must never mute the teacher). Without this the
            // voice described strokes that appeared a sentence later.
            const beatWrites = beat.draws
              .map((cue) => cue.event.action)
              .filter((a): a is Extract<TeachAction, { type: "write" }> => a.type === "write");
            if (beatWrites.length) {
              await Promise.race([
                Promise.all(beatWrites.map((a) => writeReady(a.markup, a.color ?? "ink"))),
                new Promise((r) => setTimeout(r, 3000)),
              ]);
            }
            for (const cue of beat.speech) {
              performer.activate(myKey, cue.eventIndex);
              let doneOk = false;
              while (!doneOk && !superseded()) {
                await waitUnpaused();
                doneOk = await speak(cue.event.text);
              }
            }
          })();

          const visualTask = (async () => {
            let previousCueMs = 0;
            for (const cue of beat.draws) {
              const reached = await waitForActiveMs(
                cue.atMs - previousCueMs,
                performer.paused,
                superseded,
                // When audible speech ends earlier than estimated, pending
                // visuals are flushed as one React update below. This keeps
                // the camera on the final target rather than producing a
                // chain of late pans after the teacher has stopped talking.
                () => speechFinished && beat.speech.length > 0,
              );
              if (!reached) break;
              launchDraw(cue);
              previousCueMs = cue.atMs;
            }
          })();

          await speechTask;
          speechFinished = true;
          await visualTask;
          if (superseded()) return;

          // Audio can be faster than the estimate (or muted). Mount any cues
          // it outran together, so Board performs one eased camera move to the
          // latest target while all content still appears in document order.
          for (const cue of beat.draws) launchDraw(cue);

          if (completions.length) {
            await Promise.race([
              Promise.all(completions),
              waitForActiveMs(
                beat.speech.length ? VOICED_SETTLE_MS : SILENT_SETTLE_MS,
                performer.paused,
                superseded,
              ),
            ]);
          }
          if (superseded()) return;

          // Every board step ends with a repair pass (besides the idle 900ms
          // beat): freshly-landed geometry is checked the moment it exists.
          repairNow();

          cursor = beat.to;
          const lastDraw = beat.draws.at(-1);
          performer.advance(
            myKey,
            cursor,
            lastDraw ? describeAction(lastDraw.event.action) : undefined,
          );
        }
        performer.finish(myKey);
      } finally {
        pumpingRef.current = false;
        setPerforming(false);
      }
    })();
  }, [planReady, liveKey, events.length, speak, focusBoard, repairNow]);

  useEffect(() => cancelSpeech, []);

  // Marquee select → spatial (BVH) hit description → next question's context.
  const dragRef = useRef<{ x: number; y: number; box: HTMLDivElement } | null>(null);
  const onSurfaceMouseDown = (e: React.MouseEvent) => {
    if (!selectMode) return;
    e.preventDefault();
    const box = document.createElement("div");
    box.className = "select-rect";
    box.style.cssText = `left:${e.clientX}px;top:${e.clientY}px`;
    document.body.appendChild(box);
    dragRef.current = { x: e.clientX, y: e.clientY, box };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.box.style.left = `${Math.min(d.x, ev.clientX)}px`;
      d.box.style.top = `${Math.min(d.y, ev.clientY)}px`;
      d.box.style.width = `${Math.abs(ev.clientX - d.x)}px`;
      d.box.style.height = `${Math.abs(ev.clientY - d.y)}px`;
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      d.box.remove();
      const rect = {
        x: Math.min(d.x, ev.clientX),
        y: Math.min(d.y, ev.clientY),
        w: Math.abs(ev.clientX - d.x),
        h: Math.abs(ev.clientY - d.y),
      };
      if (rect.w < 8 && rect.h < 8) return;
      performer.setSelection(
        describeHits(queryRegion(rect)) ?? "an empty area of the board",
        screenToWorld(rect),
      );
      setSelectMode(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const togglePause = () => {
    if (performer.paused()) {
      performer.resume();
      setPaused(false);
    } else {
      performer.pause();
      setPaused(true);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    onSend(text);
  };

  // Push-to-talk uses server transcription when configured and browser speech
  // recognition otherwise. The button stays visible when unavailable so an
  // insecure iPad URL produces a useful explanation instead of silently
  // removing the control.
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micMessage, setMicMessage] = useState<string | null>(null);
  const [micCapabilities, setMicCapabilities] = useState({
    checked: false,
    secure: true,
    speech: false,
    recording: false,
  });
  const recRef = useRef<SpeechRecognition | null>(null);
  const stageRecorderRef = useRef<MediaRecorder | null>(null);
  const stageStreamRef = useRef<MediaStream | null>(null);
  const stageChunksRef = useRef<Blob[]>([]);
  const stageBaseRef = useRef("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMicCapabilities({
      checked: true,
      secure: window.isSecureContext,
      speech: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      recording:
        !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined",
    });
    return () => {
      recRef.current?.stop();
      const recorder = stageRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      stageStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const toggleMic = () => {
    if (!micCapabilities.secure) {
      setMicMessage("Microphone needs HTTPS on iPad. Open the secure .ts.net Tailscale link, not the http:// IP address.");
      return;
    }
    const recorderAvailable = transcriptionAvailable && micCapabilities.recording;
    if (!recorderAvailable && !micCapabilities.speech) {
      setMicMessage("Voice input is unavailable here. Open the secure link in Safari, or configure transcription in Settings.");
      return;
    }
    if (listening) {
      const recorder = stageRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else recRef.current?.stop();
      return;
    }
    if (recorderAvailable) void startStageRecording();
    else startStageRecognition();
  };

  const startStageRecognition = () => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    setMicMessage(null);
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i]![0]!.transcript;
      setDraft(text);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = (event) => {
      setListening(false);
      recRef.current = null;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setMicMessage("Microphone blocked. On iPad, allow Microphone for this site in Safari settings, then try again.");
      } else if (event.error !== "aborted") {
        setMicMessage(event.error === "no-speech" ? "I didn't catch anything. Try again." : `Voice error: ${event.error}`);
      }
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setMicMessage("Could not start voice input. Check Safari's microphone permission and try again.");
    }
  };

  const stopStageStream = () => {
    stageStreamRef.current?.getTracks().forEach((track) => track.stop());
    stageStreamRef.current = null;
  };

  const startStageRecording = async () => {
    setMicMessage(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (cause) {
      setMicMessage(microphoneErrorMessage(cause));
      return;
    }

    stageStreamRef.current = stream;
    stageChunksRef.current = [];
    stageBaseRef.current = draft;
    const mime = preferredRecorderMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (cause) {
      stopStageStream();
      setMicMessage(microphoneErrorMessage(cause));
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) stageChunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      stopStageStream();
      stageRecorderRef.current = null;
      setListening(false);
      setMicMessage("Recording failed. Please try again.");
    };
    recorder.onstop = () => {
      const actualMime = recorder.mimeType || stageChunksRef.current[0]?.type || mime || "audio/webm";
      const blob = new Blob(stageChunksRef.current, { type: actualMime });
      stageChunksRef.current = [];
      stageRecorderRef.current = null;
      stopStageStream();
      setListening(false);
      if (blob.size === 0) {
        setMicMessage("I didn't catch anything. Try again.");
        return;
      }
      void transcribeStageAudio(blob, audioUploadName(actualMime));
    };
    stageRecorderRef.current = recorder;
    setListening(true);
    recorder.start();
  };

  const transcribeStageAudio = async (blob: Blob, filename: string) => {
    setTranscribing(true);
    setMicMessage("Transcribing…");
    try {
      const form = new FormData();
      form.append("audio", blob, filename);
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { text?: string; error?: string };
      if (!response.ok) throw new Error(body.error || `Transcription failed (${response.status}).`);
      if (!body.text) {
        setMicMessage("I didn't catch anything. Try again.");
        return;
      }
      const prefix = stageBaseRef.current;
      setDraft(`${prefix}${prefix && !prefix.endsWith(" ") ? " " : ""}${body.text}`);
      setMicMessage(null);
    } catch (cause) {
      setMicMessage(cause instanceof Error ? cause.message : "Could not transcribe that recording.");
    } finally {
      setTranscribing(false);
    }
  };

  const status = streaming
    ? "preparing"
    : performing
      ? paused
        ? "paused"
        : "writing"
      : "ready";

  const entries = useMemo(() => {
    const historyScenes: BoardEntry[] = [];
    const currentScenes: Array<{ entry: BoardEntry; order: number }> = [];
    for (const scene of directedScenes) {
      if (!scene.shown) continue;
      const entry: BoardEntry = {
        action: { type: "visual_scene", plan: scene.plan },
        key: `visual-${scene.messageId}`,
        live: true,
      };
      if (scene.messageId === liveKey) currentScenes.push({ entry, order: scene.targetEventIndex + 0.9 });
      else historyScenes.push({ ...entry, live: false });
    }
    const current = [
      ...liveEntries.map((entry) => {
        const match = /-(\d+)$/.exec(entry.key);
        return { entry, order: match ? Number(match[1]) : Number.MAX_SAFE_INTEGER };
      }),
      ...currentScenes,
    ].sort((a, b) => a.order - b.order).map(({ entry }) => entry);
    return [...baseEntries, ...historyScenes, ...current];
  }, [baseEntries, liveEntries, directedScenes, liveKey]);

  return (
    <div className="teach-stage">
      {/* Paper + world */}
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={MIN_ZOOM}
        maxScale={MAX_ZOOM}
        // Free panning — the sheet is infinite; bounds made it a document.
        limitToBounds={false}
        smooth
        wheel={{ wheelDisabled: true, step: 0.012 }}
        trackPadPanning={{ disabled: false, velocityDisabled: true }}
        panning={{
          disabled: inkNavigationBlocked,
          activationKeys: () => !penMode && !selectMode && !pencilActiveRef.current,
          velocityDisabled: false,
          allowLeftClickPan: true,
        }}
        pinch={{ disabled: false, allowPanning: true, step: 5 }}
        doubleClick={{ disabled: true }}
        velocityAnimation={{
          sensitivityTouch: 0.72,
          sensitivityMouse: 0.55,
          maxStrengthTouch: 18,
          maxStrengthMouse: 12,
          inertia: 0.72,
          animationTime: 220,
          maxAnimationTime: 360,
        }}
        onInit={onCanvasInit}
        onTransform={onCanvasTransform}
        onPanningStart={beginCanvasGesture}
        onPanningStop={endCanvasGesture}
        onPinchStart={beginCanvasGesture}
        onPinchStop={endCanvasGesture}
        onWheelStart={beginCanvasGesture}
        onWheelStop={endCanvasGesture}
      >
        <TransformComponent
          wrapperClass={`teach-surface ${penMode ? "is-inking" : selectMode ? "is-selecting" : canvasPanning ? "is-panning" : ""}`}
          contentClass="teach-world"
          wrapperStyle={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "hidden",
            // The grid is painted on the (static) wrapper but must read as
            // ink ON the sheet: track the camera so squares pan and zoom with
            // the writing — that is what makes the canvas feel endless.
            backgroundPosition: `${canvasVp.x}px ${canvasVp.y}px`,
            backgroundSize: `${28 * (canvasVp.k || 1)}px ${28 * (canvasVp.k || 1)}px`,
          }}
          contentStyle={{ width: "980px", minHeight: "1200px" }}
          wrapperProps={{
            onPointerDown: selectMode ? undefined : onSurfacePointerDown,
            onPointerUp: onSurfacePointerEnd,
            onPointerCancel: onSurfacePointerEnd,
            onMouseDown: onSurfaceMouseDown,
            onContextMenu: (event) => event.preventDefault(),
            role: "application",
            "aria-label": "Interactive lesson notebook",
          }}
        >
          <div ref={worldRef} className="notebook-world">
            <Board entries={entries} onGrow={onBoardGrow} />
            <InkLayer strokes={ink.strokes} />
          </div>
        </TransformComponent>
      </TransformWrapper>

      {/* Teach is plan-then-perform so voice, transcript, camera, and ink use
          one stable timeline. Keep planning visible while iPad's transcript
          drawer is closed, then let the synchronized performance take over. */}
      {(streaming || error) && (
        <section
          className={`overlay glass teach-reply-state ${error ? "is-error" : streamedReplyPreview ? "has-preview" : ""}`}
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
        >
          <span className="teach-reply-icon" aria-hidden>
            <Icon name={error ? "error" : streamedReplyPreview ? "edit_note" : "progress_activity"} />
          </span>
          <div className="teach-reply-copy">
            <strong>
              {error
                ? "I couldn't prepare the answer"
                : streamedReplyPreview
                  ? "Building the notebook…"
                  : "Thinking about your question…"}
            </strong>
            <p>
              {error
                ? error
                : streamedReplyPreview ||
                  "Your question was sent. The teacher is planning a clear, visual explanation."}
            </p>
          </div>
          {error && onRetry && (
            <button type="button" onClick={onRetry} className="teach-reply-retry">
              Try again
            </button>
          )}
        </section>
      )}

      {/* Breadcrumb */}
      <div className="overlay glass breadcrumb">
        <button type="button" onClick={onExit} className="crumb-link" title="Back to chat mode">
          {projectName || "Standalone"}
        </button>
        <Icon name="chevron_right" className="text-[13px]" />
        <span className="crumb-current">{title}</span>
      </div>

      {/* Toolbar */}
      <nav className="overlay toolbar">
        <div className="glass toolbar-pill">
          <div className="toolbar-brand">
            <span className="brand-mark">AiTeacher</span>
            <span className={`status-chip status-${status}`}>
              <Icon name={status === "writing" ? "edit" : status === "paused" ? "pause" : "check"} className="text-[13px]" />
              {status === "writing" ? "writing…" : status === "paused" ? "paused" : status === "preparing" ? "preparing…" : "ready"}
            </span>
            {directorStatus !== "idle" && (
              <span className={`status-chip director-status director-${directorStatus}`} title="A separate Ollama model directs lesson visuals">
                <Icon name={directorStatus === "planning" ? "progress_activity" : directorStatus === "model" ? "auto_awesome" : "schema"} className="text-[13px]" />
                {directorStatus === "planning"
                  ? "visualizing…"
                  : directorStatus === "model"
                    ? "visuals ready"
                    : directorStatus === "fallback"
                      ? "visual fallback"
                      : "visuals offline"}
              </span>
            )}
          </div>
          <div className="toolbar-tools">
            {personaControl}
            <ToolButton icon={paused ? "play_arrow" : "pause"} label={paused ? "Resume" : "Pause"} onClick={togglePause} />
            <ToolButton
              icon={muted ? "volume_off" : "volume_up"}
              label={muted ? "Unmute" : "Voice"}
              active={!muted}
              onClick={() =>
                setMuted((m) => {
                  if (!m) cancelSpeech();
                  return !m;
                })
              }
            />
            {voices.length > 0 && (
              <select
                className="voice-select mono"
                value={voice}
                onChange={(e) => {
                  setVoice(e.target.value);
                  setVoiceState(e.target.value);
                  localStorage.setItem("teach.voice", e.target.value);
                  cancelSpeech();
                }}
                title="Teacher voice (Kokoro)"
              >
                {voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            <ToolButton
              icon="stylus_note"
              label="Pen"
              active={penMode}
              onClick={() => {
                setPenMode((p) => !p);
                setSelectMode(false);
              }}
            />
            {penMode && (
              <span className="pen-controls">
                {(["red", "blue", "ink"] as InkColor[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={`${c} pen`}
                    onClick={() => {
                      setPenColor(c);
                      setEraserMode(false);
                    }}
                    className={`pen-swatch pen-swatch-${c} ${penColor === c && !eraserMode ? "is-active" : ""}`}
                  />
                ))}
                <button
                  type="button"
                  className={`pen-undo mono ${eraserMode ? "is-active-tool" : ""}`}
                  onClick={() => setEraserMode((v) => !v)}
                  title="Eraser — rub over a stroke to remove it"
                >
                  <Icon name="ink_eraser" className="text-[14px]" />
                </button>
                <button
                  type="button"
                  className="pen-undo mono"
                  onClick={ink.undo}
                  title="Undo last stroke"
                >
                  ⌫
                </button>
                {ink.strokes.length > 0 && (
                  <button
                    type="button"
                    className="pen-check mono"
                    onClick={() => void checkInkAnswer()}
                    disabled={checkingInk}
                    title="The teacher reads what you wrote and checks it"
                  >
                    <Icon name={checkingInk ? "hourglass_top" : "task_alt"} className="text-[14px]" />
                    {checkingInk ? "reading…" : "check my work"}
                  </button>
                )}
              </span>
            )}
            <ToolButton
              icon="select_window"
              label="Select"
              active={selectMode}
              onClick={() => {
                setSelectMode((v) => !v);
                setPenMode(false);
              }}
            />
            <ToolButton icon="fit_screen" label="Fit" onClick={() => resetCanvas()} />
            <ToolButton
              icon={cameraFollowing ? "center_focus_strong" : "center_focus_weak"}
              label={cameraFollowing ? "Following" : "Follow"}
              active={cameraFollowing}
              onClick={() => setCameraFollowing(!cameraFollowing)}
            />
            <ToolButton
              icon="download"
              label="Export"
              onClick={() => {
                // The lesson board as handwritten-note PDF — GoodNotes-ready.
                window.open(`/api/teach/export?conversationId=${encodeURIComponent(conversationId)}`, "_blank");
              }}
            />
          </div>
        </div>
      </nav>

      {/* Transcript */}
      <aside className={`overlay glass transcript ${transcriptOpen ? "" : "is-collapsed"}`}>
        <button
          type="button"
          className="transcript-handle glass"
          onClick={() => setTranscriptOpen((o) => !o)}
          title={transcriptOpen ? "Hide transcript" : "Show transcript"}
        >
          <Icon name={transcriptOpen ? "chevron_right" : "chevron_left"} className="text-[18px]" />
        </button>
        <header className="transcript-head">
          <div>
            <h2>Lesson Transcript</h2>
            <p className="mono">{messages.length} turns</p>
          </div>
          <Icon name="notes" className="text-ink-3" />
        </header>
        <div ref={transcriptBodyRef} className="transcript-body">
          {messages.map((m) => (
            <TranscriptTurn
              key={m.id}
              message={m}
              onJump={() => jumpToMessage(m.id)}
              active={m.id === performerStatus.activeId}
              activeEventIndex={
                m.id === performerStatus.activeId ? performerStatus.activeEventIndex : null
              }
              visualScene={directedScenes.find((scene) => scene.messageId === m.id) ?? null}
            />
          ))}
        </div>
      </aside>

      {/* Input */}
      <div className="overlay composer">
        {micMessage && (
          <div className="glass selection-chip voice-error-chip" role="status">
            <Icon name="info" className="text-[13px]" />
            <span>{micMessage}</span>
            <button type="button" onClick={() => setMicMessage(null)} title="Dismiss">
              <Icon name="close" className="text-[13px]" />
            </button>
          </div>
        )}
        {selection && (
          <div className="glass selection-chip">
            <Icon name="my_location" className="text-[13px]" />
            <span className="truncate">asking about: {selection}</span>
            <button type="button" onClick={() => performer.setSelection(null)} title="Clear">
              <Icon name="close" className="text-[13px]" />
            </button>
          </div>
        )}
        <form
          className="glass composer-pill"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <button
            type="button"
            onClick={toggleMic}
            disabled={!micCapabilities.checked || transcribing}
            className={`composer-mic ${listening ? "is-live" : ""}`}
            title={
              transcribing
                ? "Transcribing"
                : listening
                  ? "Stop recording"
                  : micCapabilities.secure
                    ? "Push to talk"
                    : "Microphone needs the secure HTTPS link"
            }
            aria-label={listening ? "Stop voice input" : "Start voice input"}
          >
            <Icon name={listening ? "graphic_eq" : "mic"} />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              ink.strokes.length
                ? "Pen down? Tap ✓ check my work — or type / speak"
                : "Ask or answer — type, hold the mic, or write on the board with the pen"
            }
            className="composer-input"
          />
          {streaming ? (
            <button type="button" onClick={onStop} className="composer-send" title="Stop">
              <Icon name="stop" />
            </button>
          ) : (
            <button type="submit" className="composer-send" disabled={!draft.trim()} title="Send">
              <Icon name="arrow_upward" />
            </button>
          )}
        </form>
      </div>

      {/* Zoom */}
      <div className="overlay zoombar">
        <div className="glass zoom-pill">
          <button type="button" onClick={() => zoomCanvasBy(1.2)} title="Zoom in">
            <Icon name="add" />
          </button>
          <span className="zoom-level mono">{Math.round(canvasVp.k * 100)}%</span>
          <button type="button" onClick={() => zoomCanvasBy(1 / 1.2)} title="Zoom out">
            <Icon name="remove" />
          </button>
          <button type="button" onClick={() => resetCanvas()} title="Fit to screen" className="zoom-fit">
            <Icon name="fit_screen" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
  active,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={`tool ${active ? "is-active" : ""}`} title={label}>
      <span className="tool-dot">
        <Icon name={icon} />
      </span>
      <span className="tool-label mono">{label}</span>
    </button>
  );
}

// One transcript turn: the teacher's spoken words render as chat bubbles;
// board fences stay compact. Both carry event ranges from the shared lesson
// stream so the current audio/board beat can highlight and auto-scroll here.
function TranscriptTurn({
  message,
  active,
  activeEventIndex,
  visualScene,
  onJump,
}: {
  message: Message;
  active: boolean;
  activeEventIndex: number | null;
  visualScene: DirectedScene | null;
  onJump?: () => void;
}) {
  const parts = useMemo(() => {
    if (message.role !== "assistant") return null;
    return toTranscriptParts(parseTeachEvents(message.content, true));
  }, [message]);

  if (message.role === "user") {
    return (
      <div className="turn turn-user">
        <span className="avatar avatar-user">
          <Icon name="person" className="text-[15px]" />
        </span>
        <p className="transcript-user-message">{message.content}</p>
      </div>
    );
  }
  return (
    <div
      className={`turn ${onJump ? "turn-jumpable" : ""}`}
      onClick={onJump}
      title={onJump ? "Jump to this part of the board" : undefined}
    >
      <span className="avatar mono">AI</span>
      <div className="turn-body">
        {(parts ?? []).map((p) => {
          const current =
            active &&
            activeEventIndex !== null &&
            activeEventIndex >= p.from &&
            activeEventIndex < p.to;
          const delivered = active && activeEventIndex !== null && p.to <= activeEventIndex;
          const className = `transcript-part ${current ? "is-current" : ""} ${
            delivered ? "is-delivered" : ""
          }`;
          return p.kind === "speak" ? (
            <p
              key={p.from}
              className={`${className} transcript-speech`}
              aria-current={current ? "true" : undefined}
              data-event-from={p.from}
            >
              {p.text}
            </p>
          ) : (
            <span
              key={p.from}
              className={`${className} step-chip mono`}
              aria-current={current ? "true" : undefined}
              data-event-from={p.from}
            >
              <Icon name="edit" className="text-[12px]" />
              {p.n} board step{p.n === 1 ? "" : "s"}
            </span>
          );
        })}
        {visualScene && (
          <span
            className={`transcript-part step-chip visual-step-chip mono ${
              active && activeEventIndex === visualScene.targetEventIndex ? "is-current" : ""
            } ${visualScene.shown ? "is-delivered" : ""}`}
            data-event-from={visualScene.targetEventIndex}
          >
            <Icon name="schema" className="text-[12px]" />
            Visual map {visualScene.shown ? "shown" : "queued"}
          </span>
        )}
      </div>
    </div>
  );
}
