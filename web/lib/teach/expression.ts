/**
 * Provider-neutral delivery cues for the teaching voice.
 *
 * Keep these names stable: a planning model may emit them in the future, and
 * cached lesson plans should continue to work when the TTS provider changes.
 */
export const TEACHING_EXPRESSIONS = [
  "neutral",
  "warm",
  "encouraging",
  "curious",
  "excited",
  "serious",
  "reassuring",
] as const;

export type TeachingExpression = (typeof TEACHING_EXPRESSIONS)[number];

export const SPEECH_PACES = ["slow", "measured", "conversational", "lively"] as const;

export type SpeechPace = (typeof SPEECH_PACES)[number];

export type SpeechExpressionCue = Readonly<{
  expression: TeachingExpression;
  pace: SpeechPace;
  /** Provider-neutral multiplier where 1 is the configured speaking rate. */
  rate: number;
}>;

type ExpressionProfile = SpeechExpressionCue & Readonly<{
  /** Kokoro-FastAPI supports volume directly; other providers may ignore it. */
  volume: number;
}>;

// Kokoro has no emotion control — speed and volume are the only levers it
// exposes, so the spread has to be wide enough to actually hear. The earlier
// ±8% rate / ±4% volume was below the just-noticeable difference and made
// every expression sound identical.
export const EXPRESSION_PROFILES: Readonly<Record<TeachingExpression, ExpressionProfile>> = {
  neutral: { expression: "neutral", pace: "conversational", rate: 1, volume: 1 },
  warm: { expression: "warm", pace: "conversational", rate: 0.92, volume: 0.94 },
  encouraging: { expression: "encouraging", pace: "lively", rate: 1.14, volume: 1.1 },
  curious: { expression: "curious", pace: "measured", rate: 0.88, volume: 0.97 },
  excited: { expression: "excited", pace: "lively", rate: 1.22, volume: 1.15 },
  serious: { expression: "serious", pace: "measured", rate: 0.82, volume: 1.06 },
  reassuring: { expression: "reassuring", pace: "slow", rate: 0.76, volume: 0.9 },
};

const REASSURING = /\b(?:don['’]t worry|no worries|take your time|it['’]s okay|that['’]s okay|this (?:can|may) (?:feel|seem)|we(?:'ll| will) (?:slow|work)|step by step)\b/i;
const ENCOURAGING = /\b(?:great|excellent|exactly|well done|nice work|you(?:'ve| have) got it|good job|perfect)\b/i;
const SERIOUS = /\b(?:important|careful|remember|warning|watch out|must|never|critical|key point)\b/i;
const WARM = /\b(?:welcome|let['’]s|together|glad|happy to)\b/i;
const QUESTION_LEAD = /^\s*(?:why|how|what|when|where|which|who|can|could|do|does|is|are|would)\b/i;

/**
 * A deterministic fallback for lessons that do not yet contain model-authored
 * delivery cues. The precedence is intentional: reassurance and safety cues
 * should not be made artificially excited just because the sentence ends in !
 */
export function inferSpeechExpression(text: string): SpeechExpressionCue {
  const clean = text.trim();
  let expression: TeachingExpression = "neutral";

  if (REASSURING.test(clean)) expression = "reassuring";
  else if (ENCOURAGING.test(clean)) expression = "encouraging";
  else if (SERIOUS.test(clean)) expression = "serious";
  else if (clean.endsWith("?") || QUESTION_LEAD.test(clean)) expression = "curious";
  else if (clean.endsWith("!") || /\b(?:amazing|wonderful|aha|now watch)\b/i.test(clean)) {
    expression = "excited";
  } else if (WARM.test(clean)) expression = "warm";

  const { pace, rate } = EXPRESSION_PROFILES[expression];
  return { expression, pace, rate };
}

export function isTeachingExpression(value: unknown): value is TeachingExpression {
  return typeof value === "string" && (TEACHING_EXPRESSIONS as readonly string[]).includes(value);
}

