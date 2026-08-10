// FSRS-5 spaced-repetition scheduling — pure math, no DB, no React.
// Transcribed from ts-fsrs's long-term scheduler (node_modules/ts-fsrs/dist,
// class `B` used when `enable_short_term: false`) and the FSRS-5 spec
// (https://github.com/open-spaced-repetition/fsrs4anki/wiki).
//
// Correctness is locked by algorithm.test.ts, which compares this module's
// repeat() to ts-fsrs's fsrs().repeat() step-by-step. If that test fails, the
// ts-fsrs source is the source of truth — fix the arithmetic here to match.

export enum Rating {
  Again = 1,
  Hard = 2,
  Good = 3,
  Easy = 4,
}

export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

export interface SchedCard {
  due: number; // ms timestamp
  stability: number; // days
  difficulty: number; // 1..10
  reps: number;
  lapses: number;
  state: CardState;
  last_review: number | null; // ms, null = never reviewed
}

export interface ReviewLogInput {
  grade: Rating;
  state: CardState; // card state BEFORE this review
  stability: number; // … BEFORE
  difficulty: number; // … BEFORE
  reviewed_at: number;
}

export const DAY_MS = 86_400_000;
export const DESIRED_RETENTION = 0.9;
export const MAX_INTERVAL_DAYS = 36500;

// FSRS-5 default 19-parameter w vector. MUST equal ts-fsrs's default params
// (asserted by the DEFAULT_W test in algorithm.test.ts). Copied from
// ts-fsrs 4.7.1's `default_w`.
export const DEFAULT_W: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
];

const DECAY = -0.5;
const FACTOR = Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1; // ≈ 0.234568 (19/81)
// ts-fsrs rounds the interval modifier to 8 dp; with retention 0.9 this is 1.0.
const INTERVAL_MODIFIER = round8(
  (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1) / FACTOR,
);
const S_MIN = 0.01;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
function safe(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}
// ts-fsrs rounds intermediate results to 8 decimal places throughout; mirror
// that exactly so the golden-vector comparison matches to < 1e-6.
function round8(x: number): number {
  return +x.toFixed(8);
}

// Elapsed days since `last` at `now`, matching ts-fsrs's date_diff (UTC day
// floor). Both timestamps are ms.
function elapsedDays(last: number, now: number): number {
  return Math.max(0, Math.floor(now / DAY_MS) - Math.floor(last / DAY_MS));
}

// Retrievability (probability of recall) at `now` for a card last reviewed at
// `last` with stability `s` (days). FSRS-5 power forgetting curve. Matches
// ts-fsrs's forgetting_curve (rounded to 8 dp, no [0,1] clamp — the curve is
// always in (0,1] for non-negative elapsed days).
export function retrievability(s: number, last: number | null, now: number): number {
  if (last == null || s <= 0) return 0;
  const el = elapsedDays(last, now);
  return round8(Math.pow(1 + (FACTOR * el) / s, DECAY));
}

// Initial stability for a brand-new card from its first grade. w[0..3] map to
// Again/Hard/Good/Easy.
function initStability(g: Rating): number {
  return Math.max(DEFAULT_W[g - 1], 0.1);
}

// Initial difficulty for a brand-new card:
//   D_0(G) = w_4 - e^((G-1) * w_5) + 1, clamped to [1,10] (8 dp).
function initDifficulty(g: Rating): number {
  return constrainDifficulty(DEFAULT_W[4] - Math.exp((g - 1) * DEFAULT_W[5]) + 1);
}

function constrainDifficulty(d: number): number {
  return Math.min(Math.max(round8(d), 1), 10);
}

// Mean reversion toward `init` (here init_difficulty(Easy)): w_7*init + (1-w_7)*current.
function meanReversion(init: number, current: number): number {
  return round8(DEFAULT_W[7] * init + (1 - DEFAULT_W[7]) * current);
}

// Linear damping on the difficulty delta: delta_d * (10 - oldD) / 9.
function linearDamping(deltaD: number, oldD: number): number {
  return round8((deltaD * (10 - oldD)) / 9);
}

// Next difficulty:
//   delta_d = -w_6 * (g - 3)
//   next_d = D + linear_damping(delta_d, D)
//   D' = w_7 * D_0(Easy) + (1 - w_7) * next_d, clamped to [1,10].
function nextDifficulty(d: number, g: Rating): number {
  const deltaD = -DEFAULT_W[6] * (g - 3);
  const nextD = d + linearDamping(deltaD, d);
  return constrainDifficulty(meanReversion(initDifficulty(Rating.Easy), nextD));
}

// Stability after a recall (Hard/Good/Easy):
//   S'_r = S * (1 + e^w_8 * (11 - D) * S^(-w_9) * (e^(w_10*(1-R)) - 1) * w_15 * w_16)
// where w_15 applies only for Hard, w_16 only for Easy. Clamped to [0.01, 36500], 8 dp.
function nextRecallStability(d: number, s: number, r: number, g: Rating): number {
  const hard = g === Rating.Hard ? DEFAULT_W[15] : 1;
  const easy = g === Rating.Easy ? DEFAULT_W[16] : 1;
  const ns =
    s *
    (1 +
      Math.exp(DEFAULT_W[8]) *
        (11 - d) *
        Math.pow(s, -DEFAULT_W[9]) *
        (Math.exp((1 - r) * DEFAULT_W[10]) - 1) *
        hard *
        easy);
  return Math.min(Math.max(round8(ns), S_MIN), MAX_INTERVAL_DAYS);
}

// Stability after a lapse (Again):
//   S'_f = w_11 * D^(-w_12) * ((S+1)^w_13 - 1) * e^(w_14*(1-R))
// Clamped to [0.01, 36500], 8 dp.
function nextForgetStability(d: number, s: number, r: number): number {
  const ns =
    DEFAULT_W[11] *
    Math.pow(d, -DEFAULT_W[12]) *
    (Math.pow(s + 1, DEFAULT_W[13]) - 1) *
    Math.exp((1 - r) * DEFAULT_W[14]);
  return Math.min(Math.max(round8(ns), S_MIN), MAX_INTERVAL_DAYS);
}

// Natural next interval (days) for one grade from its stability, clamped to
// [1, MAX]. Matches ts-fsrs's next_interval with fuzz disabled.
function nextIntervalDays(s: number): number {
  return clamp(safe(Math.round(s * INTERVAL_MODIFIER), 1), 1, MAX_INTERVAL_DAYS);
}

// Apply ts-fsrs's 4-grade interval ordering: Again < Hard < Good < Easy, each
// strictly greater than the previous (so the four previews are monotonic).
// Input/outputs are the natural per-grade intervals.
function orderIntervals(
  again: number,
  hard: number,
  good: number,
  easy: number,
): [number, number, number, number] {
  const a = Math.min(again, hard);
  const h = Math.max(hard, a + 1);
  const g = Math.max(good, h + 1);
  const e = Math.max(easy, g + 1);
  return [a, h, g, e];
}

export function repeat(
  card: SchedCard | null,
  grade: Rating,
  now: number,
): { card: SchedCard; log: ReviewLogInput } {
  const log: ReviewLogInput = {
    grade,
    state: card?.state ?? CardState.New,
    stability: card?.stability ?? 0,
    difficulty: card?.difficulty ?? 0,
    reviewed_at: now,
  };

  // --- New-card path (no prior state) ---
  // ts-fsrs (long-term scheduler) initialises all four grades from w and
  // transitions every grade to Review.
  if (card == null || card.state === CardState.New) {
    const stabs = [
      initStability(Rating.Again),
      initStability(Rating.Hard),
      initStability(Rating.Good),
      initStability(Rating.Easy),
    ];
    const [a, h, g, e] = orderIntervals(
      nextIntervalDays(stabs[0]),
      nextIntervalDays(stabs[1]),
      nextIntervalDays(stabs[2]),
      nextIntervalDays(stabs[3]),
    );
    const intervals: Record<Rating, number> = {
      [Rating.Again]: a,
      [Rating.Hard]: h,
      [Rating.Good]: g,
      [Rating.Easy]: e,
    };
    const stability = stabs[grade - 1];
    const difficulty = initDifficulty(grade);
    const intervalDays = intervals[grade];
    return {
      card: {
        due: now + intervalDays * DAY_MS,
        stability,
        difficulty,
        reps: 1,
        lapses: 0,
        state: CardState.Review,
        last_review: now,
      },
      log,
    };
  }

  // --- Existing-card path (transcribed from ts-fsrs's reviewState, class B) ---
  // Compute retrievability from the elapsed days since last_review, then the
  // four grade-specific (difficulty, stability) updates and the ordered
  // intervals. ts-fsrs (long-term) transitions every grade to Review; Again
  // increments lapses.
  const r = retrievability(card.stability, card.last_review, now);
  const priorD = card.difficulty;
  const priorS = card.stability;

  const stabAgain = Math.min(Math.max(priorS, S_MIN), nextForgetStability(priorD, priorS, r));
  const stabHard = nextRecallStability(priorD, priorS, r, Rating.Hard);
  const stabGood = nextRecallStability(priorD, priorS, r, Rating.Good);
  const stabEasy = nextRecallStability(priorD, priorS, r, Rating.Easy);

  const [a, h, g, e] = orderIntervals(
    nextIntervalDays(stabAgain),
    nextIntervalDays(stabHard),
    nextIntervalDays(stabGood),
    nextIntervalDays(stabEasy),
  );
  const intervals: Record<Rating, number> = {
    [Rating.Again]: a,
    [Rating.Hard]: h,
    [Rating.Good]: g,
    [Rating.Easy]: e,
  };
  const stabs: Record<Rating, number> = {
    [Rating.Again]: stabAgain,
    [Rating.Hard]: stabHard,
    [Rating.Good]: stabGood,
    [Rating.Easy]: stabEasy,
  };

  const lapse = grade === Rating.Again;
  const stability = stabs[grade];
  const difficulty = nextDifficulty(priorD, grade);
  const intervalDays = intervals[grade];

  return {
    card: {
      due: now + intervalDays * DAY_MS,
      stability: Math.max(S_MIN, safe(stability, card.stability)),
      difficulty,
      reps: card.reps + 1,
      lapses: card.lapses + (lapse ? 1 : 0),
      state: CardState.Review,
      last_review: now,
    },
    log,
  };
}