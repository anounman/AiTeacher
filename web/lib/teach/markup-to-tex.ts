// mathwriter markup -> LaTeX, for the Manim writer experiment.
//
// Lessons speak mathwriter's markup ([F]a|b[/F], x², ~~heading~~ — see
// mathwriter/MARKUP.md). The Manim writer wants LaTeX. Rather than change the
// prompt — which would break the mathwriter fallback and every stored lesson —
// the markup is translated at render time. Translation must be conservative:
// anything this file cannot faithfully express returns null and the item
// falls back to mathwriter, because a wrong formula drawn beautifully is the
// worst outcome on a teaching board.

const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-", "ⁿ": "n", "ⁱ": "i", "ᵀ": "T",
};
const SUBSCRIPTS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₙ": "n", "ₘ": "m", "ₐ": "a",
};
const SYMBOLS: Record<string, string> = {
  "±": "\\pm", "≠": "\\ne", "≤": "\\le", "≥": "\\ge", "≈": "\\approx",
  "→": "\\to", "⇒": "\\Rightarrow", "←": "\\leftarrow", "∞": "\\infty",
  "π": "\\pi", "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "θ": "\\theta",
  "λ": "\\lambda", "ω": "\\omega", "∈": "\\in", "∉": "\\notin",
  "⊂": "\\subset", "⊆": "\\subseteq", "∪": "\\cup", "∩": "\\cap",
  "∀": "\\forall", "∃": "\\exists", "Σ": "\\Sigma", "√": "\\sqrt{}",
  "✓": "\\checkmark", "·": "\\cdot", "×": "\\times", "−": "-",
};

// Tags with no LaTeX equivalent that keeps their meaning. Their presence
// means "let mathwriter draw this one".
const UNSUPPORTED = /\[(?:G|DRAW|T|X|V|H)\]/;

export interface TexResult {
  tex: string;
  heading: boolean;
}

// Runtime writer toggle, so the experiment is flippable on the iPad without a
// redeploy: localStorage "aiteacher.writer" = "manim" | "mathwriter".
export function manimWriterEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem("aiteacher.writer") === "manim";
  } catch {
    return false;
  }
}

function convertBody(body: string): string | null {
  let out = body;

  // Nested pair tags, innermost first, bounded passes.
  for (let pass = 0; pass < 8; pass++) {
    const before = out;
    out = out
      .replace(/\[F\]([^[\]|]*)\|([^[\]]*)\[\/F\]/g, "\\frac{$1}{$2}")
      .replace(/\[R\]([^[\]]*)\[\/R\]/g, "\\sqrt{$1}")
      .replace(/\[S\]([^[\]|]*)\|([^[\]]*)\[\/S\]/g, "\\sum_{$1}^{$2}")
      .replace(/\[I\]([^[\]|]*)\|([^[\]]*)\[\/I\]/g, "\\int_{$1}^{$2}")
      .replace(/\[B\]([^[\]]*)\[\/B\]/g, "\\boxed{$1}")
      .replace(/\[U\]([^[\]]*)\[\/U\]/g, "^{$1}")
      .replace(/\[D\]([^[\]]*)\[\/D\]/g, "_{$1}");
    if (out === before) break;
  }
  // A tag that survived conversion is one this table does not cover.
  if (/\[[A-Z]\]|\[\/[A-Z]\]/.test(out)) return null;

  out = out
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿⁱᵀ]+/g, (run) => `^{${[...run].map((c) => SUPERSCRIPTS[c]).join("")}}`)
    .replace(/[₀₁₂₃₄₅₆₇₈₉ᵢⱼₖₙₘₐ]+/g, (run) => `_{${[...run].map((c) => SUBSCRIPTS[c]).join("")}}`);
  for (const [symbol, tex] of Object.entries(SYMBOLS)) {
    out = out.split(symbol).join(` ${tex} `);
  }

  // Anything non-ASCII that remains has no mapping — do not guess at it.
  if (/[^\x20-\x7e]/.test(out)) return null;
  return out.replace(/\s+/g, " ").trim();
}

/** True when a line is better treated as prose (Text) than a formula. */
export function isProse(line: string): boolean {
  const words = line.trim().split(/\s+/);
  const mathy = /[=+\-*/^_{}\\()<>|]|\d/;
  // Several words and almost no operators reads as a sentence.
  return words.length >= 4 && words.filter((w) => mathy.test(w)).length <= words.length / 4;
}

/**
 * Convert one write action's markup. Returns null when mathwriter should keep
 * the item (tables, diagrams, anything the table cannot express faithfully).
 */
export function markupToTex(markup: string): TexResult | null {
  const trimmed = markup.trim();
  if (!trimmed || UNSUPPORTED.test(trimmed)) return null;
  // Multi-line items stay with mathwriter: Manim clips are one mobject, and
  // faking line breaks inside MathTex loses the band-per-line geometry twice
  // over.
  if (trimmed.includes("\n")) return null;

  const headingMatch = /^~~([^~]+)~~$/.exec(trimmed);
  if (headingMatch) return { tex: headingMatch[1]!.trim(), heading: true };

  const tex = convertBody(trimmed);
  if (tex === null || tex.length === 0 || tex.length > 380) return null;
  return { tex, heading: false };
}
