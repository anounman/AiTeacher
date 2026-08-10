import { test } from "node:test";
import assert from "node:assert/strict";
import {
  retrievability,
  DESIRED_RETENTION,
  DAY_MS,
} from "@/lib/fsrs/algorithm";
import {
  cardRetrievability,
  aggregateMastery,
  masteryBand,
  buildMasteryBlock,
  type Band,
} from "./model";

// FACTOR matches algorithm.ts: DESIRED_RETENTION ** (1/DECAY) - 1, DECAY = -0.5.
const FACTOR = Math.pow(DESIRED_RETENTION, 1 / -0.5) - 1; // ≈ 0.2345679 (19/81)
function expectedR(s: number, el: number): number {
  return Math.pow(1 + (FACTOR * el) / s, -0.5);
}

test("retrievability matches the FSRS-5 forgetting curve over a grid", () => {
  const now = 1_700_000_000_000;
  const stabilities = [0.5, 1, 3, 10, 100];
  const elapsed = [0, 1, 3, 7, 30, 365];
  for (const s of stabilities) {
    for (const el of elapsed) {
      const last = now - el * DAY_MS;
      const got = retrievability(s, last, now);
      const exp = expectedR(s, el);
      assert.ok(
        Math.abs(got - exp) < 1e-6,
        `s=${s} el=${el}: got ${got} vs exp ${exp}`,
      );
    }
  }
});

test("retrievability returns 0 for never-reviewed / non-positive stability", () => {
  assert.equal(retrievability(3, null, 123), 0);
  assert.equal(retrievability(0, 123, 124), 0);
  assert.equal(retrievability(-1, 123, 124), 0);
});

test("cardRetrievability reads stability + last_review", () => {
  const now = 1_700_000_000_000;
  const r = cardRetrievability({ stability: 3, last_review: now - 7 * DAY_MS }, now);
  assert.ok(Math.abs(r - expectedR(3, 7)) < 1e-6);
  assert.equal(cardRetrievability({ stability: 3, last_review: null }, now), 0);
});

test("aggregateMastery means finite R, clamps to [0,1], ignores non-finite", () => {
  assert.equal(aggregateMastery([]), null);
  assert.ok(Math.abs(aggregateMastery([0.9])! - 0.9) < 1e-9);
  assert.ok(Math.abs(aggregateMastery([0.9, 0.1])! - 0.5) < 1e-9);
  // NaN ignored → mean of the rest.
  assert.ok(Math.abs(aggregateMastery([Number.NaN, 0.2])! - 0.2) < 1e-9);
  // Clamp >1 to 1 (single value).
  assert.equal(aggregateMastery([1.2]), 1.0);
  // Clamp applied per-value before averaging: (1.0 + 0.8) / 2 = 0.9.
  assert.ok(Math.abs(aggregateMastery([1.2, 0.8])! - 0.9) < 1e-9);
  // All non-finite → null.
  assert.equal(aggregateMastery([Number.NaN, Number.POSITIVE_INFINITY]), null);
});

test("masteryBand thresholds + untested/unknown rules", () => {
  assert.equal(masteryBand(null, 0, 0), "unknown");
  assert.equal(masteryBand(null, 0, 3), "untested"); // linked, none reviewed
  assert.equal(masteryBand(0.9, 2, 2), "strong");
  assert.equal(masteryBand(0.8, 1, 1), "strong");
  assert.equal(masteryBand(0.6, 1, 1), "learning");
  assert.equal(masteryBand(0.5, 1, 1), "learning");
  assert.equal(masteryBand(0.3, 1, 1), "slipping");
  assert.equal(masteryBand(null, 1, 1), "unknown"); // reviewed but mastery null (NaN fallback)
});

test("buildMasteryBlock groups by band, caps 6, omits empty, +N more", () => {
  assert.equal(buildMasteryBlock([]), "");
  // Only unknown → empty (gated on non-unknown).
  assert.equal(buildMasteryBlock([{ label: "x", mastery: null, band: "unknown" }]), "");
  const entries: { label: string; mastery: number | null; band: Band }[] = [
    { label: "A", mastery: 0.9, band: "strong" },
    { label: "B", mastery: 0.6, band: "learning" },
    { label: "C", mastery: 0.2, band: "slipping" },
    { label: "U", mastery: null, band: "untested" },
  ];
  const block = buildMasteryBlock(entries);
  assert.match(block, /Learner mastery —/);
  assert.match(block, /strong: A/);
  assert.match(block, /learning: B/);
  assert.match(block, /slipping: C/);
  assert.match(block, /untested: U/);
  assert.match(block, /Focus explanations on slipping and untested/);
  // 7 slipping labels → 6 shown + "+1 more", slipping sorted by lowest mastery first.
  const many = Array.from({ length: 7 }, (_, i) => ({
    label: `S${i}`, mastery: 0.1 + i * 0.01, band: "slipping" as Band,
  }));
  const b2 = buildMasteryBlock(many);
  assert.match(b2, /\+1 more/);
  // S0 (lowest mastery) appears; S6 does not (it is the "+1 more").
  assert.match(b2, /S0/);
  assert.doesNotMatch(b2, /S6/);
});

test("masteryBand + aggregateMastery never throw across 1000 random card sets", () => {
  let seed = 987654321;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 1000; i++) {
    const n = Math.floor(rnd() * 5);
    const rs = Array.from({ length: n }, () => {
      const v = rnd() * 1.5 - 0.25; // include negatives / >1 / normal
      return rnd() < 0.1 ? Number.NaN : v;
    });
    const m = aggregateMastery(rs);
    assert.ok(m === null || (Number.isFinite(m) && m >= 0 && m <= 1));
    const band = masteryBand(m, Math.floor(rnd() * 3), Math.floor(rnd() * 3));
    assert.ok(["strong", "learning", "slipping", "untested", "unknown"].includes(band));
  }
});