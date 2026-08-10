export interface CanvasViewport {
  x: number;
  y: number;
  k: number;
}

export interface CanvasSize {
  w: number;
  h: number;
}

export interface CanvasRect extends CanvasSize {
  x: number;
  y: number;
}

export interface CanvasInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export const MIN_ZOOM = 0.45;
export const MAX_ZOOM = 2.5;

const MIN_CAMERA_FRAME = 180;

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

function axisBounds(viewportSize: number, contentSize: number) {
  // The sheet is infinite: programmatic camera moves may park anywhere within
  // a generous slack of the content, instead of pinning to page edges. (The
  // student's own gestures are fully unbounded — limitToBounds is off.)
  const slack = viewportSize * 0.75;
  if (contentSize <= viewportSize) {
    const centered = (viewportSize - contentSize) / 2;
    return { min: centered - slack, max: centered + slack };
  }
  return { min: viewportSize - contentSize - slack, max: slack };
}

export function constrainViewport(
  viewport: CanvasViewport,
  screen: CanvasSize,
  content: CanvasSize,
): CanvasViewport {
  const k = clampZoom(viewport.k);
  const xBounds = axisBounds(screen.w, content.w * k);
  const yBounds = axisBounds(screen.h, content.h * k);
  return {
    k,
    x: Math.min(xBounds.max, Math.max(xBounds.min, viewport.x)),
    y: Math.min(yBounds.max, Math.max(yBounds.min, viewport.y)),
  };
}

export function zoomViewportAt(
  viewport: CanvasViewport,
  factor: number,
  point: { x: number; y: number },
  screen: CanvasSize,
  content: CanvasSize,
): CanvasViewport {
  const k = clampZoom(viewport.k * factor);
  if (k === viewport.k) return constrainViewport(viewport, screen, content);
  return constrainViewport(
    {
      k,
      x: point.x - ((point.x - viewport.x) * k) / viewport.k,
      y: point.y - ((point.y - viewport.y) * k) / viewport.k,
    },
    screen,
    content,
  );
}

export function fitPageWidth(
  screen: CanvasSize,
  content: CanvasSize,
  gutter = 32,
): CanvasViewport {
  const k = clampZoom(Math.min(1, (screen.w - gutter * 2) / content.w));
  return constrainViewport(
    { x: (screen.w - content.w * k) / 2, y: 0, k },
    screen,
    content,
  );
}

export function usableCameraFrame(screen: CanvasSize, insets: CanvasInsets = {}): CanvasRect {
  const left = Math.max(0, insets.left ?? 24);
  const top = Math.max(0, insets.top ?? 24);
  const requestedRight = Math.max(0, insets.right ?? 24);
  const requestedBottom = Math.max(0, insets.bottom ?? 24);
  // A drawer can cover most of a phone-sized viewport. Preserve a usable
  // sliver instead of producing negative geometry or throwing the camera far
  // outside the page; the drawer can still be collapsed by the student.
  const right = Math.min(requestedRight, Math.max(0, screen.w - left - MIN_CAMERA_FRAME));
  const bottom = Math.min(requestedBottom, Math.max(0, screen.h - top - MIN_CAMERA_FRAME));
  return {
    x: left,
    y: top,
    w: Math.max(MIN_CAMERA_FRAME, screen.w - left - right),
    h: Math.max(MIN_CAMERA_FRAME, screen.h - top - bottom),
  };
}

export function focusViewportOnRect({
  current,
  target,
  screen,
  content,
  insets,
}: {
  current: CanvasViewport;
  target: CanvasRect;
  screen: CanvasSize;
  content: CanvasSize;
  insets?: CanvasInsets;
}): CanvasViewport {
  const k = clampZoom(current.k);
  const frame = usableCameraFrame(screen, insets);
  const targetCenterX = target.x + target.w / 2;
  // Keep the current zoom: an automatic zoom is much more disorienting than
  // a bounded pan. Park the top of the new note about one-third down the
  // unobscured canvas, leaving room for the next line beneath it.
  const desiredTop = frame.y + Math.min(frame.h * 0.34, Math.max(18, frame.h - target.h * k - 18));
  return constrainViewport(
    {
      k,
      x: frame.x + frame.w / 2 - targetCenterX * k,
      y: desiredTop - target.y * k,
    },
    screen,
    content,
  );
}
