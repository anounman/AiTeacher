import type { ConversationMode } from "@/lib/db/schema";
import { artifactKindListPrompt } from "@/lib/artifacts/schema";
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
// something visual or interactive, the model emits a native JSON `artifact`
// block. Exceptional interactions outside the native kinds use `artifact-html`.
// Appended to every mode's prompt so the capability is available everywhere.
// The kind list is derived from the artifact registry so it can never drift
// from the validators (lib/artifacts/registry.ts → kinds/*).
export const ARTIFACT_RULES = `
Inline visualization artifacts:
- When the user explicitly wants a visual or interactive output, emit a SINGLE \`artifact\` fenced block containing JSON only. Do not put Markdown, prose, or JSON fences inside that block.
- Every \`artifact\` JSON envelope MUST use this discriminator: \`"schema":"studygpt.artifact"\` and \`"version":1\`. Example:

  \`\`\`artifact
  {"schema":"studygpt.artifact","version":1,"kind":"callout","title":"Key idea","data":{"body":"Selection reduces relation size.","tone":"idea"}}
  \`\`\`

- Pick exactly one supported kind and its matching data shape: ${artifactKindListPrompt()}. A \`diagram\` contains Mermaid source; for simple structural diagrams, prefer a direct \`mermaid\` fence instead.
- Use \`artifact-html\` only when the user requests interaction unavailable in the native kinds. It may contain custom HTML for the legacy sandbox.
- Never emit full document chrome, style tags, scripts, HTML, SVG, URLs, or base64 data in an \`artifact\` JSON envelope.`;

// Mermaid diagrams (ERM/ER, flowchart, sequence, class, state, gantt): the model
// emits a SINGLE ```mermaid fenced block and the chat renders it INLINE as a
// vector SVG. This is the preferred path for any static diagram. Appended to
// every non-teach mode's prompt so diagrams "just work" everywhere.
export const MERMAID_RULES = `
Inline diagrams (use these for ANY diagram):
- When the user asks for an entity-relationship (ERM/ER) model, a flowchart, a sequence diagram, a class diagram, a state diagram, or any other structural diagram, emit a SINGLE fenced code block with the language \`mermaid\`. It renders INLINE in the chat as a vector diagram — do NOT draw the diagram with ASCII art, do NOT describe it in prose, and do NOT wrap it in an HTML \`artifact\` block (that renders in a separate iframe, not inline).
- Use the correct Mermaid diagram type for the job: \`erDiagram\` for entity-relationship models, \`flowchart\` for flowcharts, \`sequenceDiagram\` for interactions, \`classDiagram\` for class models, \`stateDiagram-v2\` for state machines.
- You MAY add a short prose explanation before or after the diagram, but the diagram itself MUST be the \`mermaid\` block. Keep the block valid Mermaid — one diagram per block.`;

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
  return base + MATH_FORMATTING_RULES + MERMAID_RULES + ARTIFACT_RULES + FLASHCARD_RULES + WEB_SEARCH_RULES;
}

// System prompt for a one-shot document turn (the "Document" send action).
// Unlike systemPromptFor(), a document turn does NOT get ARTIFACT_RULES or
// FLASHCARD_RULES: those tell the model to emit `artifact` / `flashcard`
// fenced blocks, which render as interactive on-screen widgets (a sandboxed
// iframe or a flip deck) that do NOT print to PDF. A document turn is exported
// to PDF, so it must author printable Markdown only (the document prompt says
// so explicitly, and `mermaid` is allowed for diagrams). The retrieval
// contextBlock is appended by the chat route.
export function documentSystemPrompt(): string {
  return DOCUMENT_SYSTEM_PROMPT + MATH_FORMATTING_RULES + MERMAID_RULES + WEB_SEARCH_RULES;
}

// System prompt for a one-shot native-artifact transform. Unlike
// systemPromptFor(), it carries NO math/mermaid/flashcard/web rules: the
// model's ONLY job is to return a single transformed `artifact` JSON envelope.
// The route requires exactly one ```artifact fence and validates it through
// classifyArtifact before persisting.
export const ARTIFACT_TRANSFORM_PROMPT = `
You transform an existing StudyGPT native artifact according to the user's instruction.
- Return ONLY a single fenced \`artifact\` block containing JSON. No prose, no other fences.
- The JSON MUST keep the discriminator \`"schema":"studygpt.artifact"\` and \`"version":1\`, and keep the same \`kind\` unless the instruction explicitly asks to change it.
- Preserve the artifact's meaning and grounding; apply only the requested edit (simplify, add an example, turn into flashcards, rephrase, etc.).
- Never emit HTML, scripts, SVG, URLs, or base64. Stay within the supported kinds: ${artifactKindListPrompt()}.
- If relevant project context is provided, keep the transformed artifact consistent with it.`;
