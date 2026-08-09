// Pure mastery model — no DB, no React. Reuses FSRS-5 retrievability from
// lib/fsrs/algorithm to express per-concept mastery as mean retrievability
// over the reviewed cards linked to that concept. See SP4 design spec.

import { retrievability } from "@/lib/fsrs/algorithm";

export type Band = "strong" | "learning" | "slipping" | "untested" | "unknown";

// Re-export so callers can import retrievability from the mastery barrel if desired.
export { retrievability };

// Retrievability of one card from its scheduling row. 0 if never reviewed.
export function cardRetrievability(
  sched: { stability: number; last_review: number | null },
  now: number,
): number {
  return retrievability(sched.stability, sched.last_review, now);
}

// Mean of finite R values clamped to [0,1]; null if none finite. Non-finite
// inputs (NaN/Infinity) are ignored so a corrupt row never poisons a concept.
export function aggregateMastery(rs: number[]): number | null {
  let sum = 0;
  let n = 0;
  for (const r of rs) {
    if (!Number.isFinite(r)) continue;
    sum += Math.min(1, Math.max(0, r));
    n++;
  }
  return n === 0 ? null : sum / n;
}

// Map a concept's mastery + card counts to a display band.
//  - linked === 0           → unknown
//  - linked > 0, reviewed 0 → untested
//  - mastery == null        → unknown (NaN fallback despite reviewed cards)
//  - mastery >= 0.8         → strong
//  - 0.5 <= mastery < 0.8   → learning
//  - mastery < 0.5          → slipping
export function masteryBand(
  mastery: number | null,
  reviewed: number,
  linked: number,
): Band {
  if (linked === 0) return "unknown";
  if (reviewed === 0) return "untested";
  if (mastery == null || !Number.isFinite(mastery)) return "unknown";
  if (mastery >= 0.8) return "strong";
  if (mastery >= 0.5) return "learning";
  return "slipping";
}

const BAND_ORDER: Band[] = ["strong", "learning", "slipping", "untested"];

// One-line mastery summary for the chat system prompt. Bands omitted when
// empty; each band caps at 6 labels (slipping/untested by lowest mastery first,
// strong/learning by highest first; "+N more" if exceeded). Returns "" when no
// non-unknown concept is present (the route gates injection on this).
export function buildMasteryBlock(
  entries: { label: string; mastery: number | null; band: Band }[],
): string {
  const nonUnknown = entries.filter((e) => e.band !== "unknown");
  if (nonUnknown.length === 0) return "";

  const parts: string[] = [];
  for (const band of BAND_ORDER) {
    const items = nonUnknown
      .filter((e) => e.band === band)
      .sort((a, b) => {
        // slipping/untested: lowest mastery first (biggest gaps first).
        // strong/learning: highest first.
        const asc = band === "slipping" || band === "untested";
        const av = a.mastery ?? 0;
        const bv = b.mastery ?? 0;
        return asc ? av - bv : bv - av;
      });
    if (items.length === 0) continue;
    const cap = items.slice(0, 6).map((e) => e.label).join(", ");
    const more = items.length > 6 ? ` (+${items.length - 6} more)` : "";
    parts.push(`${band}: ${cap}${more}`);
  }
  return (
    `Learner mastery — ${parts.join("; ")}. ` +
    `Focus explanations on slipping and untested concepts; connect new material to strong ones; don't re-explain what's strong.`
  );
}