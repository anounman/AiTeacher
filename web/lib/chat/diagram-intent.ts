// Heuristic: does this user message ask for a diagram/model that should be
// drawn to match the course notes' notation, and if so which kind?
//
// The diagram notation cache (app/api/chat/route.ts + lib/chat/notation.ts)
// feeds the relevant slide page images to a vision model ONCE per
// (project, diagram type) so it can *see* how the course draws that kind of
// diagram, then records a reusable text note. Every later diagram request of
// the same type reuses the note with the cheap text model — no vision call.
//
// Two tiers:
//   - Inherently-visual "…diagram"/"flowchart" nouns auto-trigger (a diagram
//     is a diagram).
//   - Model-flavored terms ("er model", "entity-relationship", "data model",
//     "erm") only trigger with a draw/make verb — "explain the ER model" stays
//     a text answer; "make/draw an ER model" goes to the notation path.
// False negatives (an oddly-phrased diagram request) just fall back to the
// text-only Mermaid path — harmless.

// Canonical diagram types the notation cache keys on. `generic` covers any
// other diagram request that names "diagram"/"schema" with a draw verb.
// `graph` covers directed transaction graphs (conflict / precedence /
// serialization / dependency / wait-for graphs) — common in DB courses, and
// NOT something Mermaid's named diagram types cover, so they need their own
// cache key + notation note.
export type DiagramType = "er" | "flowchart" | "sequence" | "class" | "state" | "graph" | "generic";

// Visual diagram nouns: a diagram is inherently a drawing. "er diagram",
// "flowchart", "sequence/class/state diagram", "relationship/schema diagram".
const DIAGRAM_TYPE_RE =
  /\b(?:er\s*diagram|flow\s*chart|flowchart|sequence\s*diagram|class\s*diagram|state\s*(?:diagram|machine)|relationship\s*diagram|schema\s*diagram|er\s*schema|erd)\b/i;

// Directed transaction-graph nouns (DB concurrency-control diagrams). These
// are inherently visual — a conflict/precedence graph IS a drawing of nodes
// + directed edges — so they auto-trigger without a draw verb, like
// "flowchart". Matched as a compound so a bare, ambiguous "graph" (bar graph,
// graph of a function) never triggers.
const GRAPH_NOUN_RE =
  /\b(?:conflict\s*graph|precedence\s*graph|serializ(?:ation|ability)\s*graph|dependency\s*graph|wait[- ]for\s*graph|transaction\s*graph)\b/i;

// Model-flavored nouns that need a draw verb to qualify (else "explain the ER
// model" / "describe the relational model" would wrongly trigger).
const MODEL_NOUN_RE =
  /\b(?:erm|er\s*model|entity[- ]relationship|data\s*model|conceptual\s*model|models?)\b/i;

const DIAGRAM_NOUN_RE = /\b(?:diagrams?|schema)\b/i;
const MAKE_VERB_RE =
  /\b(?:draw|make|create|generate|design|build|produce|sketch|give|show|render|plot|construct)\b/i;

// Map a matched phrase to a canonical DiagramType for the cache key.
function classifyMatch(text: string): DiagramType | null {
  if (/\bflow\s*chart|flowchart\b/i.test(text)) return "flowchart";
  if (/\bsequence\s*diagram\b/i.test(text)) return "sequence";
  if (/\bclass\s*diagram\b/i.test(text)) return "class";
  if (/\bstate\s*(?:diagram|machine)\b/i.test(text)) return "state";
  if (/\b(?:er\s*diagram|er\s*schema|erd|er\s*model|entity[- ]relationship|data\s*model|conceptual\s*model|erm|relationship\s*diagram|schema\s*diagram)\b/i.test(text))
    return "er";
  return "generic";
}

// Classify a user message into a canonical diagram type, or null if it isn't a
// diagram request. The cache keys on (project, DiagramType), so "make an ERM"
// and "draw an entity-relationship diagram" both map to `er` and share a note.
export function classifyDiagramType(text: string): DiagramType | null {
  // A directed transaction-graph noun → always a diagram request (inherently
  // visual, like a flowchart). Checked first so "conflict graph" maps to
  // `graph`, not `generic`.
  if (GRAPH_NOUN_RE.test(text)) return "graph";
  // A named visual diagram type → always a diagram request.
  if (DIAGRAM_TYPE_RE.test(text)) return classifyMatch(text);
  // "draw/make a diagram", "design a schema" — generic diagram noun + verb.
  if (DIAGRAM_NOUN_RE.test(text) && MAKE_VERB_RE.test(text)) return classifyMatch(text);
  // "make an erm model", "design a data model" — model noun + draw verb.
  if (MODEL_NOUN_RE.test(text) && MAKE_VERB_RE.test(text)) return classifyMatch(text);
  return null;
}

// Classify the recent USER message window for a diagram topic, so a diagram
// the model produces mid-answer — in response to a non-diagram follow-up like
// "answer?", "solve it", "continue" — still gets the course's notation. We
// look back through the last few USER messages (NOT assistant messages: a
// prior assistant answer that happens to contain diagram words would otherwise
// re-trigger notation on every later turn). The latest user message is
// already classified by the caller; this is the fallback for when it isn't a
// direct diagram request but the recent user intent clearly involves one.
export function classifyRecentUserDiagramType(userContents: string[]): DiagramType | null {
  const window = userContents.slice(-3).join("\n");
  return classifyDiagramType(window);
}

export function looksLikeDiagramRequest(text: string): boolean {
  return classifyDiagramType(text) !== null;
}