// Word-level graph between the voice and the pen: every markup word in a
// write action gets an id (its flat index across the markup's lines) and an
// edge to the position in the beat's narration where that word is spoken.
// Playback then reveals each written word when the voice reaches its edge —
// both streams execute together instead of pen-after-voice.
//
// Deterministic on purpose (ARCHITECTURE: the visual slot never gates
// playback). The teach prompt forbids notation in prose — the voice says
// "u times v" while the board shows "u v = ..." — so raw string equality
// would match almost nothing. A small verbalizer expands board symbols into
// the words a voice would say before matching.

export interface WordCue {
  /** Flat markup word index: lines split on whitespace, counted in order. */
  word: number;
  /** Speech event this word is spoken in. */
  eventIndex: number;
  /** Character offset within that event's text where the match starts. */
  charIndex: number;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

// 0-99 as one joined token ("twentyfive"), matching how normalizeSpoken
// collapses "twenty-five" / "twenty five" narration.
function numberWord(digits: string): string | null {
  if (!/^\d{1,2}$/.test(digits)) return null;
  const n = Number(digits);
  if (n < 10) return ONES[n]!;
  if (n < 20) return TEENS[n - 10]!;
  return TENS[Math.floor(n / 10)]! + (n % 10 ? ONES[n % 10]! : "");
}

// The voice and the board pick freely among these for the same thing.
const ALIASES: string[][] = [
  ["minus", "negative"],
  ["times", "into", "by"],
  ["over", "divided"],
];

const SYMBOL_WORDS: Array<[RegExp, string]> = [
  // mathwriter engine tokens ([F]a|b[/F] fractions, [R]…[/R] roots, [B]old[/B],
  // ~~heading~~) are layout, not sound — drop the tags, voice the structure.
  [/\[\/?[A-Za-z]+\]/g, " "],
  [/~~/g, " "],
  [/\|/g, " over "],
  [/±/g, " plus or minus "],
  [/∫/g, " integral "],
  [/∑/g, " sum "],
  [/√/g, " square root "],
  [/∞/g, " infinity "],
  [/π/g, " pi "],
  [/θ/g, " theta "],
  [/λ/g, " lambda "],
  [/Δ|δ/g, " delta "],
  [/α/g, " alpha "],
  [/β/g, " beta "],
  [/→|⇒/g, " gives "],
  [/≈/g, " approximately "],
  [/≠/g, " not equal "],
  [/≤/g, " at most "],
  [/≥/g, " at least "],
  [/>/g, " greater than "],
  [/</g, " less than "],
  [/=/g, " equals "],
  [/\+/g, " plus "],
  [/·|×|\*/g, " times "],
  [/−|-/g, " minus "],
  [/\//g, " over "],
  [/\^2\b/g, " squared "],
  [/\^3\b/g, " cubed "],
  [/\^/g, " to the "],
  [/²/g, " squared "],
  [/³/g, " cubed "],
];

// One markup word → the list of spoken-word tokens it could sound like.
// "x^2" → ["x", "squared"]; "u·v" → ["u", "times", "v"]; "2" → ["2"|"two"].
export function verbalizeWord(word: string): string[] {
  let s = word.toLowerCase();
  for (const [re, replacement] of SYMBOL_WORDS) s = s.replace(re, replacement);
  return s
    .split(/[^a-z0-9']+/)
    .filter(Boolean)
    .filter((t) => t.length > 1 || /^[a-z0-9]$/.test(t));
}

function normalizeSpoken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9']/g, "");
}

interface SpeechRef {
  eventIndex: number;
  text: string;
}

interface SpokenToken {
  norm: string;
  eventIndex: number;
  charIndex: number;
  /** Position in the flattened spoken stream — for monotonicity. */
  ord: number;
}

function tokenizeSpeech(speech: SpeechRef[]): SpokenToken[] {
  const tokens: SpokenToken[] = [];
  for (const s of speech) {
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s.text))) {
      const norm = normalizeSpoken(m[0]);
      if (norm) tokens.push({ norm, eventIndex: s.eventIndex, charIndex: m.index, ord: tokens.length });
    }
  }
  return tokens;
}

function tokenMatches(spoken: string, said: string): boolean {
  if (spoken === said) return true;
  // Digits on the board, words in the mouth (and vice versa). "twenty five"
  // spoken as two tokens still matches on its first ("twenty" starts
  // numberWord("25")).
  const saidNum = numberWord(said);
  if (saidNum && (saidNum === spoken || saidNum.startsWith(spoken))) return true;
  const spokenNum = numberWord(spoken);
  if (spokenNum && spokenNum === said) return true;
  for (const group of ALIASES) {
    if (group.includes(spoken) && group.includes(said)) return true;
  }
  return false;
}

/**
 * Build the word graph for one write action against the narration of its
 * beat. Matching is monotonic — the pen never jumps back to an earlier point
 * of the narration — and unmatched words simply get no cue (they reveal with
 * their neighbours). Returns [] when fewer than 30% of markup words matched:
 * a graph that sparse is noise, and the caller falls back to paced reveal.
 */
export function alignWriteToSpeech(markup: string, speech: SpeechRef[]): WordCue[] {
  const spoken = tokenizeSpeech(speech);
  if (!spoken.length) return [];

  const markupWords = markup
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/\s+/).filter(Boolean));
  if (!markupWords.length) return [];

  const cues: WordCue[] = [];
  let cursor = 0; // ord of the earliest spoken token still available
  for (let w = 0; w < markupWords.length; w++) {
    const sounds = verbalizeWord(markupWords[w]!);
    if (!sounds.length) continue;
    // The word is cued by its FIRST sound; later sounds only advance the
    // cursor so "x squared" consumes both tokens.
    let matchOrd = -1;
    for (let o = cursor; o < spoken.length; o++) {
      if (tokenMatches(spoken[o]!.norm, sounds[0]!)) {
        matchOrd = o;
        break;
      }
    }
    if (matchOrd < 0) continue;
    const tok = spoken[matchOrd]!;
    cues.push({ word: w, eventIndex: tok.eventIndex, charIndex: tok.charIndex });
    cursor = matchOrd + 1;
    for (let s = 1; s < sounds.length && cursor < spoken.length; s++) {
      if (tokenMatches(spoken[cursor]!.norm, sounds[s]!)) cursor++;
    }
  }

  return cues.length / markupWords.length >= 0.3 ? cues : [];
}
