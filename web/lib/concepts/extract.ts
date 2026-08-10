import { generateObject, generateText, type LanguageModel } from "ai";
import { db } from "@/lib/db";
import {
  listMaterials,
  getMaterial,
  listChunksForMaterial,
  conceptId,
  upsertConcept,
  upsertConceptSource,
  deleteConceptSourcesForMaterial,
  recomputeConceptSourceCounts,
  upsertEdge,
  listEdgesForProject,
  listConceptsForProject,
  listConceptEmbeddingsForProject,
  updateConceptEmbedding,
  deleteSemanticSimilarityEdgesForProject,
  llmLinkedPairs,
  getMaterialExtraction,
  upsertMaterialExtraction,
  countConceptsForMaterial,
  setEdgeCountsForProject,
} from "@/lib/db";
import { embedManyTexts, encodeEmbedding, decodeEmbedding, cosine } from "@/lib/embed";
import { getModelConfig, getProvider } from "@/lib/llm/provider";
import { conceptExtractionSchema, type ConceptExtractionOutput } from "@/lib/concepts/schema";
import { CONCEPT_EXTRACTION_PROMPT } from "@/lib/prompts";
import { normalizeLabel, contentHash } from "@/lib/concepts/slug";

// Concepts whose label-embeddings are at least this similar get a computed
// semantically_similar_to edge (INFERRED). Below this they're considered
// unrelated. 0.78 is a common "about-the-same-topic" threshold for
// nomic-embed-text.
const SIMILARITY_THRESHOLD = 0.78;

// Cap per-chunk LLM fan-out so we don't hammer the local model with N
// simultaneous generateObject calls. 3 keeps throughput up without
// over-subscribing a single Ollama instance.
const CONCURRENCY = 3;

// Per-chunk LLM call timeout. Without this, a slow/stuck model call on a
// dense chunk blocks its worker-pool slot forever — observed as a build that
// hangs indefinitely on large materials. On timeout we let the chunk fail
// (non-fatal: recorded, skipped) rather than wait infinitely or retry into
// another slow call. 90s is generous for an ~800-char chunk at medium reasoning.
const PER_CALL_TIMEOUT_MS = 90_000;

// Reasoning effort for extraction. "high" was several× slower per chunk with
// no noticeable concept-quality gain for this task; "medium" is the right
// cost/quality point for pulling concepts + relations out of study text.
const REASONING_EFFORT = "medium" as const;

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

// Extract concepts + edges from one chunk via structured output. Falls back to
// a fenced-JSON generateText + lenient parse if the model rejects AI SDK
// structured mode (some local models don't support the JSON-schema tool mode).
// A timeout aborts without a fallback (don't burn a second 90s on an already
// stuck chunk) — the caller records the chunk as failed and moves on.
async function extractChunk(model: LanguageModel, chunkText: string): Promise<ConceptExtractionOutput> {
  try {
    const { object } = await generateObject({
      model,
      schema: conceptExtractionSchema,
      schemaName: "ConceptExtraction",
      system: CONCEPT_EXTRACTION_PROMPT,
      prompt: chunkText,
      providerOptions: { ollama: { reasoningEffort: REASONING_EFFORT } },
      abortSignal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
      maxRetries: 0,
    });
    return object;
  } catch (err) {
    // Timeout/stuck → bail now; the caller logs a chunk error (non-fatal).
    if (isAbortError(err)) throw err;
    // Structured-output mode unsupported, or a transient schema failure: fall
    // back to a plain generateText + lenient parse (also timeout-bounded).
    const { text } = await generateText({
      model,
      system:
        CONCEPT_EXTRACTION_PROMPT +
        "\n\nReturn ONLY a single fenced ```json code block containing the JSON object, nothing else.",
      prompt: chunkText,
      providerOptions: { ollama: { reasoningEffort: REASONING_EFFORT } },
      abortSignal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
      maxRetries: 0,
    });
    return parseLenient(text);
  }
}

// Parse a model response that may be a fenced ```json block or a bare object,
// then validate against the zod schema. Any failure → empty result (the chunk
// contributes no concepts rather than aborting the whole extraction).
function parseLenient(text: string): ConceptExtractionOutput {
  const fence = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return { concepts: [], edges: [] };
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return conceptExtractionSchema.parse(parsed);
  } catch {
    return { concepts: [], edges: [] };
  }
}

// Cursor-based worker pool: run at most `limit` fn calls concurrently. Per-item
// errors are captured (non-fatal) into `errors` keyed by index; results hold
// undefined for failed items so positions line up with `items`.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<{ results: (R | undefined)[]; errors: Map<number, Error> }> {
  const results: (R | undefined)[] = new Array(items.length);
  const errors = new Map<number, Error>();
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        errors.set(i, e instanceof Error ? e : new Error(String(e)));
        results[i] = undefined;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return { results, errors };
}

// Look up a concept's label for embedding. Kept private; uses the top-level
// `db` directly rather than a public helper since it's an internal extractor need.
function getConceptLabel(id: string): string | undefined {
  const row = db.prepare("SELECT label FROM concepts WHERE id = ?").get(id) as { label: string } | undefined;
  return row?.label;
}

// Embed only the newly-created concepts (hintIds) that still lack an embedding.
// Re-extraction of an unchanged material doesn't re-embed existing concepts.
async function embedMissingConcepts(projectId: string, hintIds: Set<string>): Promise<void> {
  void projectId; // ids are globally unique; projectId kept for symmetry/future use
  if (hintIds.size === 0) return;
  const need: { id: string; label: string }[] = [];
  for (const id of hintIds) {
    const row = db.prepare("SELECT embedding FROM concepts WHERE id = ?").get(id) as
      | { embedding: Buffer | null }
      | undefined;
    if (row && row.embedding == null) {
      const label = getConceptLabel(id);
      if (label) need.push({ id, label });
    }
  }
  if (need.length === 0) return;
  const vecs = await embedManyTexts(need.map((n) => n.label));
  for (let i = 0; i < need.length; i++) {
    updateConceptEmbedding(need[i].id, encodeEmbedding(vecs[i]));
  }
}

// Recompute the semantically_similar_to edges from concept-embedding cosine.
// Deletes the old computed edges first (so dropped pairs don't linger), then
// for every unlinked pair with similarity ≥ threshold adds an INFERRED edge.
// O(n²) over concepts — fine for study-scale graphs (hundreds of concepts).
function computeSimilarityEdges(projectId: string): void {
  deleteSemanticSimilarityEdgesForProject(projectId);
  const rows = listConceptEmbeddingsForProject(projectId);
  if (rows.length < 2) return;
  const linked = llmLinkedPairs(projectId);
  for (let i = 0; i < rows.length; i++) {
    const aEmb = decodeEmbedding(rows[i].embedding);
    const aId = rows[i].id;
    for (let j = i + 1; j < rows.length; j++) {
      const bId = rows[j].id;
      const [x, y] = aId < bId ? [aId, bId] : [bId, aId];
      if (linked.has(`${x} ${y}`)) continue;
      const sim = cosine(aEmb, decodeEmbedding(rows[j].embedding));
      if (sim >= SIMILARITY_THRESHOLD) {
        upsertEdge(
          projectId,
          aId,
          bId,
          "semantically_similar_to",
          "INFERRED",
          Math.max(0.4, Math.min(0.95, sim)),
          null,
        );
      }
    }
  }
}

// Main entry point: extract concepts + edges from every ready material in the
// project. Idempotent per material via content_hash (unchanged materials are
// skipped). Per-chunk/per-material errors are non-fatal and collected.
export async function extractConceptsForProject(projectId: string): Promise<{
  processed: number;
  concepts: number;
  edges: number;
  skipped: number;
  errors: string[];
}> {
  const cfg = getModelConfig();
  const provider = getProvider(cfg.provider);
  const model = provider.languageModel({ model: cfg.model, baseURL: cfg.baseURL, apiKey: cfg.apiKey });

  const materials = listMaterials(projectId).filter((m) => m.status === "ready");
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];
  const newConceptIds = new Set<string>();

  for (const m of materials) {
    const full = getMaterial(m.id);
    const hash = contentHash(full?.text ?? "");
    const prior = getMaterialExtraction(m.id);
    if (prior && prior.status === "ready" && prior.content_hash === hash) {
      skipped++;
      continue;
    }

    upsertMaterialExtraction(m.id, projectId, "extracting");
    deleteConceptSourcesForMaterial(m.id); // clean re-extract: drop chunks it no longer contains
    const chunks = listChunksForMaterial(m.id);
    if (chunks.length === 0) {
      upsertMaterialExtraction(m.id, projectId, "ready", { contentHash: hash, conceptCount: 0 });
      processed++;
      continue;
    }

    const { results, errors: chunkErrors } = await mapWithConcurrency(chunks, CONCURRENCY, (c) =>
      extractChunk(model, c.text),
    );
    for (const [idx, err] of chunkErrors) {
      errors.push(`material "${m.title}" chunk ${chunks[idx].ordinal}: ${err.message}`);
    }

    // Pass A: upsert concepts + provenance, build a material-level label→slug
    // map so Pass B can resolve edge endpoints (an edge may reference a concept
    // label that appeared in a different chunk of the same material).
    const labelToSlug = new Map<string, string>();
    for (let i = 0; i < results.length; i++) {
      const out = results[i];
      if (!out) continue;
      const ordinal = chunks[i].ordinal;
      for (const c of out.concepts) {
        const slug = normalizeLabel(c.label);
        if (!slug) continue; // label that normalizes to empty (e.g. all symbols) → drop
        if (!labelToSlug.has(c.label)) labelToSlug.set(c.label, slug);
        const { id, created } = upsertConcept(projectId, slug, c.label, c.description);
        if (created) newConceptIds.add(id);
        upsertConceptSource(id, m.id, ordinal, c.evidence ?? null);
      }
    }
    // Pass B: edges, resolving labels to deterministic concept ids. Skip edges
    // whose endpoints aren't in this material's concepts or that self-loop.
    for (const out of results) {
      if (!out) continue;
      for (const e of out.edges) {
        const srcSlug = labelToSlug.get(e.source);
        const tgtSlug = labelToSlug.get(e.target);
        if (!srcSlug || !tgtSlug || srcSlug === tgtSlug) continue;
        upsertEdge(
          projectId,
          conceptId(projectId, srcSlug),
          conceptId(projectId, tgtSlug),
          e.relation,
          e.confidence,
          e.confidence_score,
          e.evidence ?? null,
        );
      }
    }

    recomputeConceptSourceCounts(projectId);
    upsertMaterialExtraction(m.id, projectId, "ready", {
      contentHash: hash,
      conceptCount: countConceptsForMaterial(m.id),
    });
    processed++;
  }

  // After all materials: embed newly-created concepts and recompute the
  // computed similarity edges across the whole project.
  await embedMissingConcepts(projectId, newConceptIds);
  computeSimilarityEdges(projectId);
  const totalEdges = listEdgesForProject(projectId).length;
  setEdgeCountsForProject(projectId, totalEdges);

  return {
    processed,
    concepts: listConceptsForProject(projectId).length,
    edges: totalEdges,
    skipped,
    errors,
  };
}