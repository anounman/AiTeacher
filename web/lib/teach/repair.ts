// Board repair loop (deliberately NOT a vision loop): every element already
// has measured geometry — the spatial matrix — so overlap detection is exact
// rectangle math. A vision pass was evaluated and rejected: no configured
// cloud model accepts images (verified against nemotron/minimax/glm/deepseek,
// all "does not support image input"), and the local vision model cold-loads
// in ~45s — a repair loop that slow would gate every lesson. Geometry runs in
// microseconds, cannot hallucinate, and is idempotent.
//
// v1 scope: margin asides are the movable layer (flow items cannot overlap
// each other — they stack in document flow). An aside that intersects column
// content or another aside slides down to the first clear slot.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function intersects(a: Box, b: Box, slack = 4): boolean {
  return (
    a.x + slack < b.x + b.w &&
    b.x + slack < a.x + a.w &&
    a.y + slack < b.y + b.h &&
    b.y + slack < a.y + a.h
  );
}

/**
 * For each movable box (in given order), the vertical shift needed so it
 * overlaps neither any obstacle nor an earlier (already shifted) movable.
 * Pure and deterministic — same inputs, same shifts.
 */
export function planShifts(obstacles: Box[], movables: Box[], gap = 14): number[] {
  const placed: Box[] = [];
  return movables.map((box) => {
    let y = box.y;
    for (let guard = 0; guard < 100; guard++) {
      const at = { ...box, y };
      const hit = [...obstacles, ...placed].find((other) => intersects(at, other));
      if (!hit) break;
      y = hit.y + hit.h + gap;
    }
    placed.push({ ...box, y });
    return y - box.y;
  });
}

/**
 * Measure the live board and shift margin asides out of any overlap.
 * Geometry is read in world units (viewport rects unscaled by k, relative to
 * the world origin). The shift is applied as a transform so React re-renders
 * (which patch left/top/width) never fight it. Safe to call at any cadence.
 */
export function repairBoard(world: HTMLElement, k: number): number {
  const origin = world.getBoundingClientRect();
  const scale = k || 1;
  const toWorld = (r: DOMRect): Box => ({
    x: (r.left - origin.left) / scale,
    y: (r.top - origin.top) / scale,
    w: r.width / scale,
    h: r.height / scale,
  });

  const obstacles = Array.from(
    world.querySelectorAll<HTMLElement>(".board-section .board-item"),
  )
    .map((el) => toWorld(el.getBoundingClientRect()))
    .filter((b) => b.w > 0 && b.h > 0);

  const asides = Array.from(world.querySelectorAll<HTMLElement>(".board-aside"));
  if (!asides.length) return 0;

  // Measure each aside at its untransformed position so repairs re-derive
  // from scratch instead of compounding.
  const bases = asides.map((el) => {
    const r = toWorld(el.getBoundingClientRect());
    const applied = Number(el.dataset.repairDy ?? "0");
    return { el, box: { ...r, y: r.y - applied } };
  });
  bases.sort((a, b) => a.box.y - b.box.y);

  const shifts = planShifts(obstacles, bases.map((b) => b.box));
  let moved = 0;
  bases.forEach(({ el }, i) => {
    const dy = Math.round(shifts[i]!);
    if (Number(el.dataset.repairDy ?? "0") !== dy) moved++;
    el.dataset.repairDy = String(dy);
    el.style.transform = dy ? `translateY(${dy}px)` : "";
  });
  return moved;
}

// v2 hard rule: a mark label never sits on ink. Ink = every handwriting
// canvas and stroke svg on the board; labels are the second movable layer
// and slide down (eased by CSS, so the student SEES the board fix itself)
// to the first slot with MIN_INK_GAP clearance.
const MIN_INK_GAP = 10;

export function repairLabels(world: HTMLElement, k: number): number {
  const origin = world.getBoundingClientRect();
  const scale = k || 1;
  const toWorld = (r: DOMRect): Box => ({
    x: (r.left - origin.left) / scale,
    y: (r.top - origin.top) / scale,
    w: r.width / scale,
    h: r.height / scale,
  });

  const labels = Array.from(world.querySelectorAll<HTMLElement>(".mark-note"));
  if (!labels.length) return 0;

  const ink = Array.from(
    world.querySelectorAll<HTMLElement>(".board-item canvas, .board-item .stroke-row svg"),
  )
    .map((el) => toWorld(el.getBoundingClientRect()))
    .filter((b) => b.w > 4 && b.h > 4);

  const bases = labels.map((el) => {
    const r = toWorld(el.getBoundingClientRect());
    const applied = Number(el.dataset.repairDy ?? "0");
    return { el, box: { ...r, y: r.y - applied } };
  });
  bases.sort((a, b) => a.box.y - b.box.y);

  const shifts = planShifts(ink, bases.map((b) => b.box), MIN_INK_GAP);
  let moved = 0;
  bases.forEach(({ el }, i) => {
    const dy = Math.round(shifts[i]!);
    if (Number(el.dataset.repairDy ?? "0") !== dy) moved++;
    el.dataset.repairDy = String(dy);
    el.style.transform = dy ? `translateY(${dy}px)` : "";
  });
  return moved;
}
