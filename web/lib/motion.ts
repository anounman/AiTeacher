"use client";

import type { Variants, Transition } from "motion/react";
import { useReducedMotion } from "motion/react";

// Shared motion vocabulary for the Studio Notebook redesign. Every animated
// element should read `prefersReducedMotion` via the `useMotion` helper (or the
// `useReducedMotion` hook directly) so the global CSS hammer isn't the only
// guard. Keep motion subtle: short durations, the paper-ease, small distances.

export const EASE_OUT: Transition["ease"] = [0.22, 1, 0.36, 1];

export const transition: Transition = { duration: 0.28, ease: EASE_OUT };
export const fastTransition: Transition = { duration: 0.16, ease: EASE_OUT };

/** Fade + rise — the default enter for cards, bubbles, panels, list rows. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition },
  exit: { opacity: 0, y: -6, transition: fastTransition },
};

/** Opacity-only — for overlays and elements where a shift would feel noisy. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: fastTransition },
  exit: { opacity: 0, transition: fastTransition },
};

/** Container that staggers its children's `fadeUp` (capped to avoid long waits). */
export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

/** A blinking caret shown at the end of a streaming assistant bubble. */
export const streamingCursor: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: [1, 0, 1], transition: { duration: 1, repeat: Infinity, ease: "linear" } },
};

/** A flashcard flip impression: the face fades and half-flips (rotateY + scale)
 *  on swap. Used with AnimatePresence keyed by `flipped` so each flip re-enters.
 *  The `useMotion` wrapper reduces this to an instant swap when preferred. */
export const cardFlip: Variants = {
  hidden: { opacity: 0, rotateY: -75, scale: 0.94 },
  visible: { opacity: 1, rotateY: 0, scale: 1, transition: { duration: 0.26, ease: EASE_OUT } },
  exit: { opacity: 0, rotateY: 75, scale: 0.94, transition: fastTransition },
};

/**
 * Returns props to spread onto a `motion.*` element that disable all entrance
 * animation when the user prefers reduced motion. Pair with the variants above:
 * `const m = useMotion(); <motion.div {...m} variants={fadeUp} ... />`.
 * Reduces to `initial={false}` so the element renders at its `visible` state
 * with no transition.
 */
export function useMotion() {
  const reduce = useReducedMotion();
  return reduce
    ? { initial: false, animate: "visible" as const, exit: undefined }
    : { initial: "hidden" as const, animate: "visible" as const, exit: "exit" as const };
}

/** Transition for shared-layout movement (active markers and reordered rows).
 * It respects the same reduced-motion preference as entrance animations. */
export function useLayoutMotion(): Transition {
  const reduce = useReducedMotion();
  return reduce ? { duration: 0 } : fastTransition;
}
