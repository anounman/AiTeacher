// Deterministic study-action recommender. Pure function — NO model call.
// Inspects answer content, persisted sources, and project concept/mastery
// bands to suggest at most two follow-up actions. See
// docs/superpowers/specs/2026-08-15-study-workflow-upgrades-design.md §4.

export type StudyActionId =
  | "explain-formula"
  | "worked-example"
  | "compare-concepts"
  | "quiz-me"
  | "inspect-source";

export type StudyAction = {
  id: StudyActionId;
  label: string;
  prompt: string;
  selectedText: string;
};

export type StudyActionConcept = {
  label: string;
  band?: "new" | "needs-practice" | "review" | "mastered" | string | null;
};

export type StudyActionInput = {
  content: string;
  sources?: unknown[];
  concepts?: StudyActionConcept[];
};

// Math detection signal set — bounded, no model reasoning parsed.
const MATH_SYMBOLS = "∑∫πλθ√≈≤≥≠→∞";
const LATEX_COMMANDS = ["\\frac", "\\sum", "\\int", "\\sqrt", "\\partial", "\\alpha", "\\beta", "\\theta", "\\lambda", "\\pi"];

function hasMathSignal(content: string): boolean {
  if (/\$[^$]+\$/.test(content)) return true; // inline math
  if (/\\\([^)]+\\\)/.test(content)) return true; // \( ... \)
  if (/\\\[[^\]]+\\\]/.test(content)) return true; // \[ ... \]
  for (const cmd of LATEX_COMMANDS) if (content.includes(cmd)) return true;
  for (const ch of MATH_SYMBOLS) if (content.includes(ch)) return true;
  // Equation-like line: a line containing `=` with a variable and a
  // digit/paren/prime — catches `f'(x) = 2x` without eating prose "a = b".
  for (const line of content.split(/\n+/)) {
    if (!line.includes("=")) continue;
    if (/[A-Za-z]/.test(line) && /[0-9(']/.test(line)) return true;
  }
  return false;
}

// Extract a formula snippet that actually occurs in `content` (so indexOf is
// valid). Tries delimited math first, then an equation-like run around `=`.
function formulaSnippet(content: string): string {
  const inline = content.match(/\$([^$]+)\$/);
  if (inline) return inline[1];
  const paren = content.match(/\\\(([^)]+)\\\)/);
  if (paren) return paren[1];
  const bracket = content.match(/\\\[([^\]]+)\\\]/);
  if (bracket) return bracket[1];
  // Equation-like run: variable (with optional args) = expression.
  const eq = content.match(/[A-Za-z][A-Za-z0-9']*\s*(?:\([^)]*\))?\s*=\s*[A-Za-z0-9'+\-*/^() ]+/);
  if (eq) return eq[0].trim();
  // Fallback: a window around the first `=` line.
  const line = content.split(/\n+/).find((l) => l.includes("="));
  if (line) return line.trim().slice(0, 120);
  return content.slice(0, 60);
}

const CONTRAST_TERMS = [
  "versus",
  "vs",
  "vs.",
  "compared to",
  "compare to",
  "difference between",
  "unlike",
  "whereas",
  "in contrast",
];

function comparisonClause(content: string): string | null {
  const lower = content.toLowerCase();
  for (const term of CONTRAST_TERMS) {
    const idx = lower.indexOf(term);
    if (idx === -1) continue;
    // Expand to the surrounding sentence (up to the previous/next sentence
    // boundary) so the selectedText carries both sides of the contrast.
    const start = content.lastIndexOf(".", idx) + 1;
    let end = content.indexOf(".", idx);
    if (end === -1) end = content.length; else end += 1;
    const clause = content.slice(start, end).trim();
    if (clause && content.indexOf(clause) !== -1) return clause;
  }
  // "while … however" pattern.
  const whileIdx = lower.indexOf("while");
  const howeverIdx = lower.indexOf("however");
  if (whileIdx !== -1 && howeverIdx !== -1 && howeverIdx > whileIdx) {
    const start = content.lastIndexOf(".", whileIdx) + 1;
    let end = content.indexOf(".", howeverIdx);
    if (end === -1) end = content.length; else end += 1;
    const clause = content.slice(start, end).trim();
    if (clause && content.indexOf(clause) !== -1) return clause;
  }
  return null;
}

// Find where a concept label is mentioned in content. Matches the exact label
// first, then falls back to progressively shorter word-boundary prefixes (so
// "conflict serializability" still anchors to "conflict serializable"). Returns
// the matched substring from the ORIGINAL content (case preserved) so it is a
// valid selectedText, or null when not mentioned.
function findConceptMention(label: string, content: string): string | null {
  const normLabel = label.toLowerCase().trim();
  if (!normLabel) return null;
  const lower = content.toLowerCase();
  const exact = lower.indexOf(normLabel);
  if (exact !== -1) return content.slice(exact, exact + normLabel.length);
  for (let len = normLabel.length; len >= 6; len--) {
    const prefix = normLabel.slice(0, len);
    let idx = lower.indexOf(prefix);
    while (idx !== -1) {
      const atBoundary = idx === 0 || /\W/.test(lower[idx - 1]);
      if (atBoundary) return content.slice(idx, idx + prefix.length);
      idx = lower.indexOf(prefix, idx + 1);
    }
  }
  return null;
}

function isLowMastery(band: string | null | undefined): boolean {
  return band === "new" || band === "needs-practice";
}

function firstSentence(content: string): string {
  const dot = content.indexOf(". ");
  if (dot !== -1) return content.slice(0, dot + 1);
  return content.slice(0, Math.min(content.length, 160));
}

export function suggestStudyActions(input: StudyActionInput): StudyAction[] {
  const content = input.content ?? "";
  const trimmed = content.trim();

  // Skip empty/whitespace and error-looking content.
  if (!trimmed) return [];
  if (/^(error|failed|unable|could not)\b/i.test(trimmed) || trimmed.startsWith("⚠")) return [];

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const concepts = Array.isArray(input.concepts) ? input.concepts : [];

  const math = hasMathSignal(content);
  const clause = comparisonClause(content);
  const lowConcepts = concepts
    .map((c) => ({ concept: c, mention: findConceptMention(c.label, content) }))
    .filter((x) => x.mention && isLowMastery(x.concept.band));

  const hasSignal = math || !!clause || lowConcepts.length > 0 || sources.length > 0;

  // Short acknowledgement: no substantive signal AND (very short OR no sentence
  // punctuation and short). Formula content with math is NOT skipped here.
  if (
    !hasSignal &&
    (trimmed.length < 40 || (!/[.!?]/.test(trimmed) && trimmed.length < 80))
  ) {
    return [];
  }

  const actions: StudyAction[] = [];

  // 1. Quiz on a low-mastery mentioned concept — ranked FIRST per the plan.
  if (lowConcepts.length > 0) {
    const { concept, mention } = lowConcepts[0];
    actions.push({
      id: "quiz-me",
      label: "Quiz me on this",
      prompt: `Quiz me on: ${mention}`,
      selectedText: mention!,
    });
    void concept;
  }

  // 2. Formula explanation + worked example.
  if (math) {
    const snippet = formulaSnippet(content);
    actions.push({
      id: "explain-formula",
      label: "Explain this formula",
      prompt: `Explain the formula: ${snippet}`,
      selectedText: snippet,
    });
    actions.push({
      id: "worked-example",
      label: "Show a worked example",
      prompt: `Show a worked example using this formula: ${snippet}`,
      selectedText: snippet,
    });
  }

  // 3. Comparison.
  if (clause) {
    actions.push({
      id: "compare-concepts",
      label: "Compare these concepts",
      prompt: `Compare these concepts: ${clause}`,
      selectedText: clause,
    });
  }

  // 4. Source inspection.
  if (sources.length > 0) {
    const snippet = firstSentence(content);
    actions.push({
      id: "inspect-source",
      label: "Inspect the source",
      prompt: `Show me the supporting source for: ${snippet}`,
      selectedText: snippet,
    });
  }

  return actions.slice(0, 2);
}