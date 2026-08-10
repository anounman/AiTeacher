import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FSRS,
  State as TsState,
  createEmptyCard,
  default_w,
  type Card as TsCard,
} from "ts-fsrs";
import {
  repeat,
  DEFAULT_W,
  DESIRED_RETENTION,
  MAX_INTERVAL_DAYS,
  DAY_MS,
  Rating,
  CardState,
  type SchedCard,
} from "./algorithm";

// Oracle configured to match the in-repo impl exactly: same w, retention,
// max interval, and short-term memory DISABLED (pure stability scheduling).
// NOTE: ts-fsrs 4.x names the option `enable_short_term` (not
// `enable_short_term_memory`); using the wrong key would silently leave
// short-term memory ON (the default) and diverge from the in-repo impl.
const oracle = new FSRS({
  w: [...DEFAULT_W] as number[],
  request_retention: DESIRED_RETENTION,
  maximum_interval: MAX_INTERVAL_DAYS,
  enable_short_term: false,
});

function toOracleCard(c: SchedCard): TsCard {
  // ts-fsrs uses Date for due/last_review; convert from ms. Build a full Card
  // (createEmptyCard's generic return doesn't spread cleanly under strict tsc).
  const base = createEmptyCard() as TsCard;
  return {
    ...base,
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as unknown as TsState,
    last_review: c.last_review == null ? undefined : new Date(c.last_review),
    due: new Date(c.due),
  } as unknown as TsCard;
}

const SEQ: Rating[] = [
  Rating.Good, Rating.Good, Rating.Again, Rating.Hard, Rating.Good,
  Rating.Easy, Rating.Again, Rating.Good, Rating.Hard, Rating.Easy,
  Rating.Again, Rating.Again, Rating.Good, Rating.Easy, Rating.Hard,
];

test("DEFAULT_W matches ts-fsrs's default params", () => {
  assert.equal(DEFAULT_W.length, default_w.length);
  for (let i = 0; i < DEFAULT_W.length; i++) {
    assert.ok(
      Math.abs(DEFAULT_W[i] - default_w[i]) < 1e-12,
      `w[${i}]: ${DEFAULT_W[i]} vs ${default_w[i]}`,
    );
  }
});

test("repeat() matches ts-fsrs across a fixed grade sequence", () => {
  let ours: SchedCard | null = null;
  let theirs: TsCard = createEmptyCard();
  const t0 = 1_700_000_000_000; // fixed `now` start (deterministic)
  let t = t0;
  for (let i = 0; i < SEQ.length; i++) {
    const g = SEQ[i];
    const now = t;
    // advance the clock to the card's due date before each review
    const stepNow = ours == null ? now : Math.max(now, ours.due);
    const out = repeat(ours, g, stepNow);
    const oracleOut = (
      oracle.repeat(
        toOracleCard(theirs as unknown as SchedCard),
        new Date(stepNow),
      ) as unknown as Record<number, { card: TsCard }>
    )[g];
    const oracleCard = oracleOut.card as unknown as SchedCard & {
      due: Date;
      last_review?: Date;
    };

    const ourIntervalDays = (out.card.due - stepNow) / DAY_MS;
    const oracleIntervalDays = (oracleCard.due.getTime() - stepNow) / DAY_MS;

    assert.ok(Number.isFinite(out.card.stability), `step ${i}: stability finite`);
    assert.ok(Number.isFinite(out.card.due), `step ${i}: due finite`);
    assert.equal(
      out.card.state,
      oracleCard.state as unknown as CardState,
      `step ${i}: state`,
    );
    assert.equal(out.card.reps, oracleCard.reps, `step ${i}: reps`);
    assert.equal(out.card.lapses, oracleCard.lapses, `step ${i}: lapses`);
    assert.ok(
      Math.abs(out.card.stability - oracleCard.stability) < 1e-6,
      `step ${i}: stability ${out.card.stability} vs ${oracleCard.stability}`,
    );
    assert.ok(
      Math.abs(out.card.difficulty - oracleCard.difficulty) < 1e-6,
      `step ${i}: difficulty ${out.card.difficulty} vs ${oracleCard.difficulty}`,
    );
    assert.ok(
      Math.abs(ourIntervalDays - oracleIntervalDays) <= 1,
      `step ${i}: interval ${ourIntervalDays} vs ${oracleIntervalDays}`,
    );

    ours = out.card;
    theirs = oracleCard as unknown as TsCard;
    t = stepNow + 1;
  }
});

test("repeat() never produces NaN/Infinity across 1000 random grades", () => {
  let card: SchedCard | null = null;
  let now = 1_700_000_000_000;
  // Deterministic LCG so the run is reproducible (Math.random is fine but LCG
  // makes a failure reproducible).
  let seed = 123456789;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 1000; i++) {
    const g = (1 + Math.floor(rnd() * 4)) as Rating;
    now = card == null ? now : Math.max(now, card.due);
    const { card: next } = repeat(card, g, now);
    assert.ok(Number.isFinite(next.due), `i=${i}: due finite`);
    assert.ok(Number.isFinite(next.stability), `i=${i}: stability finite`);
    assert.ok(Number.isFinite(next.difficulty), `i=${i}: difficulty finite`);
    assert.ok(next.stability >= 0.1, `i=${i}: stability >= 0.1`);
    assert.ok(
      next.difficulty >= 1 && next.difficulty <= 10,
      `i=${i}: difficulty in [1,10]`,
    );
    card = next;
  }
});