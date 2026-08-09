import type { ConversationMode } from "@/lib/db/schema";
import { CHAT_SYSTEM_PROMPT } from "./chat";
import { FEYNMAN_SYSTEM_PROMPT } from "./feynman";
import { TEACH_SYSTEM_PROMPT } from "./teach";
import { DOCUMENT_SYSTEM_PROMPT } from "./document";
import { CONCEPT_EXTRACTION_PROMPT } from "./concepts";

export { CHAT_SYSTEM_PROMPT, FEYNMAN_SYSTEM_PROMPT, DOCUMENT_SYSTEM_PROMPT, CONCEPT_EXTRACTION_PROMPT };

// Formatting constraints for mathematical outputs, appended to every system
// prompt so equations render cleanly in the chat UI without breaking line
// heights. Keep this authoritative — the per-mode prompts only carry a brief
// reminder.
export const MATH_FORMATTING_RULES = `
Formatting constraints for mathematical output (MUST follow):
- Delimiters: ALWAYS use $...$ for inline math and $$...$$ for display math. NEVER use \\(...\\) or \\[...\\] delimiters — they do NOT render in this interface and will appear as raw text. Every math expression must be wrapped in $ or $$.
- Structural spacing: never produce a wall of text. Use short paragraphs and a blank line between logical steps. Add labeled sub-sections only when they make a multi-part answer easier to scan.
- Strict display math: for ANY equation that includes fractions (\\frac), limits (\\lim), summations, integrals, or exceeds a few basic terms, use display math ($$ ... $$). A display equation must sit on its OWN line with a blank line above and below it.
- Limited inline math: use inline math ($ ... $) ONLY for single variables (e.g., $x$), simple coordinates, or flat expressions (e.g., $x > 0$). NEVER put fractions, limits, summations, or multi-term expressions inside single $ delimiters.
- Step-by-step layout: separate the explanatory text from the mathematical operation. Do NOT inline a complex result inside a sentence.

  Incorrect: "We use the rule $f'(x) = \\frac{3}{2}\\sqrt{x}$ to find the answer."
  Correct:
  We use the standard power rule:

  $$f'(x) = \\frac{3}{2}\\sqrt{x}$$

  Then continue the explanation.`;

// When the user asks to visualize / render / draw / plot / diagram / build
// something visual or interactive, the model emits a single ```artifact fenced
// block containing a complete, self-contained HTML document; the chat renders
// it inline in a sandboxed iframe (see components/Artifact.tsx). Appended to
// every mode's prompt so the capability is available everywhere.
export const ARTIFACT_RULES = `
Inline visualization artifacts:
- When the user asks you to visualize, render, draw, plot, diagram, animate, or build something visual or interactive, emit a SINGLE fenced code block with the language \`artifact\` containing a COMPLETE, self-contained HTML document that renders it in a browser.
- The artifact renders in a sandboxed iframe. Use inline <style> and <script>. You MAY load libraries from a CDN with <script src="https://..."> (e.g. Chart.js, Plotly, D3, Mermaid, KaTeX, Three.js). It cannot access the parent page, so be fully self-contained: inline your data as JS.
- Make it work standalone: full HTML structure, sensible responsive width, a reasonable height, and your data inline. For charts use Chart.js or Plotly; for diagrams use Mermaid or D3 or hand-drawn SVG; for math use KaTeX from CDN.
- Emit an \`artifact\` block ONLY when the user explicitly wants a visual/interactive output. For ordinary code answers, use normal fenced code blocks with the real language. You may add a short prose explanation before the artifact, but the artifact block itself must contain ONLY the HTML.`;

// Flashcard decks: the user asks for "flashcards" / "quiz me" / "test me on X".
// The model emits a SINGLE ```flashcard block in the Q:/A: line-marker format;
// the chat renders it as an interactive flip deck with a "save to my decks"
// action. Appended to every mode's prompt so flashcards work in chat, Feynman,
// and document modes. Mirrors ARTIFACT_RULES (appended in systemPromptFor +
// documentSystemPrompt).
export const FLASHCARD_RULES = `
Inline flashcard decks:
- When the user asks for flashcards, a study deck, or to quiz/test them on a topic, emit a SINGLE fenced code block with the language \`flashcard\`. Do not wrap it in another language.
- Use exactly this line-marker format:
  # Deck title (optional, first line)
  Q: the question (markdown; may span multiple lines until the next marker)
  A: the answer (markdown; may span multiple lines until the next marker)
  Q: ...
  A: ...
- Aim for 6–12 cards covering the topic's core. Keep each face SHORT — one idea per card. Math uses $...$ inline and $$...$$ display, same as the rest of the chat.
- The block must contain ONLY the cards (and optional title). You may add a brief prose intro before the block, but no prose inside it and no trailing prose after it.
- Emit a \`flashcard\` block ONLY when the user explicitly asks for flashcards/quiz/test cards. For ordinary explanations, answer in prose.`;

// Web search: steer the model to actually invoke the web_search tool for
// current/factual questions instead of declining. Appended to every system
// prompt (alongside the math/artifact/flashcard rules). The chat route also
// injects the current date and a per-turn note stating whether the tool is
// available, so the model knows its training data may be stale and searches
// rather than hedging.
export const WEB_SEARCH_RULES = `
Web search:
- You may have a web_search tool for questions needing current or verifiable facts: recent events, news, model or product releases, benchmark scores, pricing, up-to-date documentation, or anything you are not certain is in your training data. Your knowledge has a cutoff and may be months out of date.
- PREFER calling web_search over declining or hedging. If a question is about anything current, recent, versioned, or numerically specific, SEARCH FIRST, then answer from the results and cite sources inline.
- Do NOT refuse a factual question by saying you "don't have data" or "can't verify" while a web_search tool is available — use it. Only say you cannot answer after you have searched (or when no search tool is available this turn) and still cannot find it.
- After searching, synthesize the findings concisely and cite titles or URLs where useful.`;

export function systemPromptFor(mode: ConversationMode): string {
  // Teach mode carries its own strict spoken/board protocol; the shared math
  // formatting rules would contradict it (they demand $-delimited math in
  // prose, teach forbids math in prose entirely).
  if (mode === "teach") return TEACH_SYSTEM_PROMPT + WEB_SEARCH_RULES;
  const base = mode === "feynman" ? FEYNMAN_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;
  return base + MATH_FORMATTING_RULES + ARTIFACT_RULES + FLASHCARD_RULES + WEB_SEARCH_RULES;
}

// System prompt for a one-shot document turn (the "Document" send action).
// Mirrors systemPromptFor(): document base + the shared math rules + artifact
// rules + flashcard rules. The retrieval contextBlock is appended by the chat
// route, just as it is for the chat/feynman modes — so a document in a project
// conversation stays grounded in the project's reference materials.
export function documentSystemPrompt(): string {
  return DOCUMENT_SYSTEM_PROMPT + MATH_FORMATTING_RULES + ARTIFACT_RULES + FLASHCARD_RULES + WEB_SEARCH_RULES;
}
