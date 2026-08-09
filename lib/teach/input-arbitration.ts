export interface TouchNavigationInput {
  penMode: boolean;
  pencilPointerActive: boolean;
  activeInkStroke: boolean;
  navigationGestureActive: boolean;
  touchCount: number;
  touchTypes: string[];
}

/**
 * Safari exposes Apple Pencil twice: as a PointerEvent (`pointerType=pen`)
 * and as a legacy TouchEvent (`touchType=stylus`). The ink engine consumes
 * the first stream; this predicate keeps the canvas camera from consuming
 * the second stream at the same time.
 */
export function shouldBlockTouchNavigation(input: TouchNavigationInput): boolean {
  // Once two-finger navigation has begun, its move/end events must reach the
  // gesture engine even after the first finger lifts.
  if (input.navigationGestureActive) return false;

  // Two direct touches are always an explicit notebook navigation gesture.
  if (input.touchCount >= 2) return false;

  const hasStylusTouch = input.touchTypes.some((type) =>
    /^(stylus|pencil)$/i.test(type),
  );
  if (hasStylusTouch || input.pencilPointerActive) return true;

  // A single finger is ink only while the Pen tool is active.
  return input.penMode && (input.touchCount === 1 || input.activeInkStroke);
}
