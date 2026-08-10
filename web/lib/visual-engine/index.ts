/**
 * The writing engine, end to end: query -> ConceptDoc -> PositionedGraph.
 *
 * visualizeConcept() is the public entry point. It runs Stage 1 (decompose + repair) to get a
 * validated ConceptDoc, then Stage 2 (layout) to get a PositionedGraph. Stage 3 (render) is
 * left to the caller, who draws the graph into its own <svg> via render.drawConcept() — this
 * keeps the engine free of DOM dependencies and lets the UI (or a server exporter) own the
 * rendering surface.
 *
 * Framework-agnostic; this whole directory merges into AiTeacher's lib/ unchanged. AiTeacher
 * injects its own LLMClient (resolving the `visual` slot) instead of OllamaClient.
 */
import { type ConceptDoc } from "./schema";
import { type LLMClient } from "./decompose";
import {
  type ProduceOptions,
  type ProduceResult,
  produceDoc,
} from "./repair";
import { type PositionedGraph, layout } from "./layout";

// Side-effect imports: packs self-register their templates + render primitives at module load.
// Marking these as side-effectful keeps bundlers from tree-shaking them out.
import "./packs/generic";
import "./packs/cs";

export interface VisualizeOptions extends ProduceOptions {}
export interface VisualizeResult {
  doc: ConceptDoc;
  graph: PositionedGraph;
  produce: ProduceResult;
}

export async function visualizeConcept(
  query: string,
  client: LLMClient,
  opts: VisualizeOptions = {},
): Promise<VisualizeResult> {
  const produce = await produceDoc(query, client, opts);
  const graph = layout(produce.doc);
  return { doc: produce.doc, graph, produce };
}

// Re-export the public surface so consumers import from one place.
export * from "./schema";
export * from "./decompose";
export * from "./repair";
export * from "./layout";
export * from "./render";
export * from "./registry";
export * from "./subjects";