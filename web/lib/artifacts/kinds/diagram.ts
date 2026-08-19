import { registerKind, boundedString, hasOnlyKeys } from "../registry";

export type DiagramData = { mermaid: string };

// Mermaid-expressible diagram ad-hoc kinds route here directly. ER-flavored
// and graph kinds are ALSO listed here as a Mermaid fallback: when the model
// emits `{kind:"erm", data:{mermaid:"..."}}` (Mermaid content in an ad-hoc
// envelope), `figure`'s validator rejects it and `diagram` accepts. `figure`
// is registered BEFORE `diagram` (see kinds/index.ts) so for shared aliases
// the candidate order is [figure, diagram] — figure (notation DSL) gets first
// crack, diagram (Mermaid) catches the fallback.
const DIAGRAM_ALIASES = [
  "flowchart", "flow-chart", "flow",
  "sequence", "sequence-diagram",
  "class", "class-diagram",
  "state", "state-diagram", "state-machine",
  // ER + graph aliases — shared with `figure` (fallback to Mermaid).
  "er", "erm", "erd", "er-model", "er-diagram", "entity-relationship",
  "relationship-diagram", "schema-diagram", "er-schema", "data-model", "conceptual-model",
  "graph", "precedence-graph", "conflict-graph", "wait-for-graph",
  "dependency-graph", "transaction-graph", "serializability-graph", "serialization-graph",
];

registerKind({
  kind: "diagram",
  label: "Diagram",
  promptSpec: `data:{mermaid:string}`,
  aliases: DIAGRAM_ALIASES,
  validate(data): { ok: true; data: DiagramData } | { ok: false; reason: string } {
    if (!hasOnlyKeys(data as Record<string, unknown>, ["mermaid"]) || !boundedString((data as { mermaid?: unknown }).mermaid, 1000)) {
      return { ok: false, reason: "Diagram data must contain a Mermaid string of at most 1,000 characters" };
    }
    return { ok: true, data: { mermaid: (data as { mermaid: string }).mermaid } };
  },
});
