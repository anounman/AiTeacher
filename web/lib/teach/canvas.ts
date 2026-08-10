"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import {
  fitPageWidth,
  focusViewportOnRect,
  zoomViewportAt,
  type CanvasInsets,
  type CanvasViewport,
} from "./camera-geometry";

export { MAX_ZOOM, MIN_ZOOM } from "./camera-geometry";
export type Viewport = CanvasViewport;

const CAMERA_MS = 320;

// GoodNotes-style notebook camera. react-zoom-pan-pinch owns the high-rate DOM
// transform and native touch gesture loop; this hook owns the app policy:
// bounded programmatic moves, fit-to-page, unobscured camera frames, and the
// rule that any manual navigation pauses the teacher's follow camera.
export function useCanvas() {
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<CanvasViewport>({ x: 0, y: 0, k: 1 });
  const [vp, setVp] = useState<CanvasViewport>({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const [following, setFollowingState] = useState(true);
  const followingRef = useRef(true);
  const paintRef = useRef<number | null>(null);

  const syncViewport = useCallback((next: CanvasViewport) => {
    vpRef.current = next;
    if (paintRef.current !== null) return;
    paintRef.current = requestAnimationFrame(() => {
      paintRef.current = null;
      setVp({ ...vpRef.current });
    });
  }, []);

  useEffect(
    () => () => {
      if (paintRef.current !== null) cancelAnimationFrame(paintRef.current);
    },
    [],
  );

  const setFollowing = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowingState(value);
  }, []);

  const markManual = useCallback(() => {
    // Unlike the old six-second timer, manual control stays authoritative
    // until the student explicitly turns Follow back on.
    setFollowing(false);
  }, [setFollowing]);

  const sizes = useCallback(() => {
    const wrapper = surfaceRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return null;
    return {
      screen: { w: wrapper.clientWidth, h: wrapper.clientHeight },
      content: { w: content.offsetWidth, h: content.offsetHeight },
    };
  }, []);

  const apply = useCallback(
    (next: CanvasViewport, duration = CAMERA_MS) => {
      transformRef.current?.setTransform(next.x, next.y, next.k, duration, "easeOutCubic");
      syncViewport(next);
    },
    [syncViewport],
  );

  const fit = useCallback(
    (manual = true) => {
      const measured = sizes();
      if (!measured) return;
      if (manual) markManual();
      apply(fitPageWidth(measured.screen, measured.content), manual ? 240 : 1);
    },
    [apply, markManual, sizes],
  );

  const onInit = useCallback(
    (controls: ReactZoomPanPinchRef) => {
      surfaceRef.current = controls.instance.wrapperComponent;
      contentRef.current = controls.instance.contentComponent;
      requestAnimationFrame(() => fit(false));
    },
    [fit],
  );

  const onTransform = useCallback(
    (_controls: ReactZoomPanPinchRef, state: { scale: number; positionX: number; positionY: number }) => {
      syncViewport({ x: state.positionX, y: state.positionY, k: state.scale });
    },
    [syncViewport],
  );

  const beginGesture = useCallback(() => {
    markManual();
    setPanning(true);
  }, [markManual]);

  const endGesture = useCallback(() => setPanning(false), []);

  const zoomBy = useCallback(
    (factor: number) => {
      const measured = sizes();
      if (!measured) return;
      markManual();
      const next = zoomViewportAt(
        vpRef.current,
        factor,
        { x: measured.screen.w / 2, y: measured.screen.h / 2 },
        measured.screen,
        measured.content,
      );
      apply(next, 180);
    },
    [apply, markManual, sizes],
  );

  const focus = useCallback(
    (
      worldRect: { x: number; y: number; w: number; h: number },
      opts?: { force?: boolean; insets?: CanvasInsets },
    ) => {
      if (!opts?.force && !followingRef.current) return false;
      const measured = sizes();
      if (!measured) return false;
      const current = vpRef.current;
      const target = focusViewportOnRect({
        current,
        target: worldRect,
        screen: measured.screen,
        content: measured.content,
        insets: opts?.insets,
      });
      if (
        Math.abs(target.x - current.x) < 24 &&
        Math.abs(target.y - current.y) < 24 &&
        target.k === current.k
      ) {
        return false;
      }
      apply(target);
      return true;
    },
    [apply, sizes],
  );

  return {
    vp,
    transformRef,
    surfaceRef,
    onInit,
    onTransform,
    beginGesture,
    endGesture,
    panning,
    following,
    setFollowing,
    zoomBy,
    reset: fit,
    focus,
  };
}
