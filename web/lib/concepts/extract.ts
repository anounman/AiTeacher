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
  deleteConceptsForProject,
  deleteExtractionsForProject,
  setBuildProgress,
  clearBuildProgress,
} from "@/lib/db";
import { embedManyTexts, encodeEmbedding, decodeEmbedding, cosine } from "@/lib/embed";
import { getModelConfig, getProvider } from "@/lib/llm/provider";
import { conceptExtractionSchema, SYMMETRIC_RELATIONS, type ConceptExtractionOutput } from "@/lib/concepts/schema";
import { CONCEPT_EXTRACTION_PROMPT } from "@/lib/prompts";
import { normalizeLabel, contentHash } from "@/lib/concepts/slug";

// Concepts whose label-embeddings are at least this similar get a computed
// semantically_similar_to edge (INFERRED). Below this they're considered
// unrelated. 0.78 is a common "about-the-same-topic" threshold for
// nomic-embed-text.
const SIMILARITY_THRESHOLD = 0.78;

// Cap per-chunk LLM fan-out so we don't hammer the local model with N
// Per-chunk LLM fan-out width. Measured against the Ollama cloud backend
// (glm-5.2:cloud via localhost:11434): 4 concurrent ≈ 1 request's latency, but
// 8 concurrent spreads 1.3→4.75s — the backend runs only ~4 requests at once
// and queues the rest. So the cloud width is a small buffer above 4 to keep
// those slots fed through per-call latency variance, not a large fan-out
// (which would just build a local queue and inflate memory). A single *local*
// Ollama model serializes through one slot, so we stay narrow there. The
// configured model name carries Ollama's ":cloud" suffix for cloud-hosted
// models, so we adapt the width to the backend actually in use.
const CLOUD_CONCURRENCY = 6;
const LOCAL_CONCURRENCY = 3;
function extractionConcurrency(model: string): number {
  return model.endsWith(":cloud") ? CLOUD_CONCURRENCY : LOCAL_CONCURRENCY;
}

// Per-chunk LLM call timeout. Without this, a slow/stuck model call on a
// dense chunk blocks its worker-pool slot forever — observed as a build that
// hangs indefinitely on large materials. On timeout we let the chunk fail
// (non-fatal: recorded, skipped) rather than wait infinitely or retry into
// another slow call. 90s is generous for a chunk at low reasoning.
const PER_CALL_TIMEOUT_MS = 90_000;

// Reasoning effort for extraction. Tested high → medium → low: high was
// several× slower with no concept-quality gain. medium vs low: low is 2–3×
// faster per chunk and extraction (pulling a handful of broad concepts +
// their relations from a text chunk) is mechanical enough that low holds up.
// Favors throughput for decks with many chunks; revisit if edge quality drops.
const REASONING_EFFORT = "low" as const;

// Hard per-chunk concept cap (backstop). The prompt asks for ≤ ~5 broad
// concepts per chunk; this guarantees a disobedient model can't blow a chunk
// up to dozens of fine-grained terms. The model lists most-central concepts
// first, so we keep the leading MAX. Edges referencing a dropped concept are
// skipped. This is the single biggest guard against "236 concepts per chapter".
const MAX_CONCEPTS_PER_CHUNK = 6;

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
//
// `force` wipes the project's existing concept graph + extraction records first
// and re-extracts every ready material from scratch. Use it when the
// extraction prompt/granularity changed and the old fine-grained graph should
// be replaced rather than merged onto (a plain re-run would skip unchanged
// materials and leave their old concepts as orphans).
export async function extractConceptsForProject(
  projectId: string,
  opts: { force?: boolean } = {},
): Promise<{
  processed: number;
  concepts: number;
  edges: number;
  skipped: number;
  errors: string[];
}> {
  const cfg = getModelConfig();
  const provider = getProvider(cfg.provider);
  const model = provider.languageModel({ model: cfg.model, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  const concurrency = extractionConcurrency(cfg.model);

  // Forced rebuild: drop the old graph + extraction state so nothing is skipped
  // and no orphan concepts linger. Card scheduling / review history survive.
  if (opts.force) {
    deleteConceptsForProject(projectId); // cascades to edges / sources / card_concepts
    deleteExtractionsForProject(projectId);
  }

  const materials = listMaterials(projectId).filter((m) => m.status === "ready");
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];
  const newConceptIds = new Set<string>();

  // Chunk-level progress for the UI's progress bar: total = chunks across all
  // ready materials (one query), and a per-material count so skipped materials
  // can be accounted for without re-querying. The extract POST writes
  // processed/total as chunks complete; GET /api/concepts polls it.
  const chunkCounts = new Map<string, number>();
  let totalChunks = 0;
  {
    const rows = db
      .prepare(
        "SELECT material_id, COUNT(*) AS n FROM chunks WHERE material_id IN (SELECT id FROM materials WHERE project_id = ? AND status = 'ready') GROUP BY material_id",
      )
      .all(projectId) as { material_id: string; n: number }[];
    for (const r of rows) {
      chunkCounts.set(r.material_id, r.n);
      totalChunks += r.n;
    }
  }
  let processedChunks = 0;
  if (totalChunks > 0) setBuildProgress(projectId, 0, totalChunks);
  try {
  for (const m of materials) {
    const full = getMaterial(m.id);
    const hash = contentHash(full?.text ?? "");
    const prior = getMaterialExtraction(m.id);
    // Skip only a *clean* prior extraction of unchanged content. A "ready" row
    // with a non-null error had chunk failures (partial or total) — re-extract
    // to retry the failed chunks instead of freezing the incomplete result. A
    // total failure is stamped status='error' below, which also isn't skipped.
    // A clean run that yielded 0 concepts (e.g. a table-of-contents material)
    // is a real empty result and is skipped, so genuinely-empty materials
    // don't re-run the LLM on every build.
    if (!opts.force && prior && prior.status === "ready" && prior.content_hash === hash && !prior.error) {
      if (totalChunks > 0) {
        processedChunks += chunkCounts.get(m.id) ?? 0;
        setBuildProgress(projectId, processedChunks, totalChunks);
      }
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

    const { results, errors: chunkErrors } = await mapWithConcurrency(chunks, concurrency, async (c) => {
      const out = await extractChunk(model, c.text);
      // Chunk done → bump the progress bar. processedChunks++ is single-threaded
      // safe (no await between the read and write); setBuildProgress is sync.
      if (totalChunks > 0) {
        processedChunks++;
        setBuildProgress(projectId, processedChunks, totalChunks);
      }
      return out;
    });
    for (const [idx, err] of chunkErrors) {
      errors.push(`material "${m.title}" chunk ${chunks[idx].ordinal}: ${err.message}`);
    }

    // Every chunk failed — typically the model was unreachable, so the calls
    // fail fast and chunkErrors covers the whole set. This is a *failed*
    // extraction, not a "ready with 0 concepts" one: stamp status='error' so
    // the chip surfaces the failure and the next build re-extracts (error rows
    // aren't skipped). This is the hole that previously bricked projects at
    // 0 concepts when the model was down during the first build.
    if (chunkErrors.size === chunks.length) {
      upsertMaterialExtraction(m.id, projectId, "error", {
        contentHash: hash,
        error: `all ${chunks.length} chunk(s) failed extraction`,
      });
      continue;
    }
    // Partial failure: complete the extraction from the surviving chunks, but
    // record the failure count so the chip surfaces it and the next build
    // re-extracts to retry the failed chunks (a ready row with a non-null
    // error isn't skipped).
    const chunkErrorSummary = chunkErrors.size > 0 ? `${chunkErrors.size}/${chunks.length} chunk(s) failed` : null;

    // All DB writes for this material in one transaction so a crash leaves
    // consistent state — concepts/sources/edges and the "ready" stamp land
    // together or not at all. The LLM fan-out ran above (outside the txn); only
    // the sync merges are atomic (better-sqlite3 transactions can't span awaits).
    db.transaction(() => {
      // Pass A: upsert concepts + provenance. Apply the per-chunk cap here so a
      // chunk that returned too many (despite the prompt) only contributes its
      // leading MAX_CONCEPTS_PER_CHUNK concepts. validSlugs is the set of slugs
      // present for this material, used by Pass B to ground edge endpoints.
      const validSlugs = new Set<string>();
      for (let i = 0; i < results.length; i++) {
        const out = results[i];
        if (!out) continue;
        const ordinal = chunks[i].ordinal;
        const kept = out.concepts.slice(0, MAX_CONCEPTS_PER_CHUNK);
        for (const c of kept) {
          const slug = normalizeLabel(c.label);
          if (!slug) continue; // label that normalizes to empty (e.g. all symbols) → drop
          validSlugs.add(slug);
          const { id, created } = upsertConcept(projectId, slug, c.label, c.description);
          if (created) newConceptIds.add(id);
          upsertConceptSource(id, m.id, ordinal, c.evidence ?? null);
        }
      }
      // Pass B: edges, resolving endpoints by slug (not exact label) so an edge
      // whose label drifted in casing/spacing from the concept label still
      // grounds. Skip edges whose endpoints aren't in this material's concepts
      // (incl. capped-out ones) or that self-loop. For symmetric relations,
      // canonicalize direction (source id < target id) so a reversed emission
      // collapses onto the same edge instead of creating two.
      for (const out of results) {
        if (!out) continue;
        for (const e of out.edges) {
          const srcSlug = normalizeLabel(e.source);
          const tgtSlug = normalizeLabel(e.target);
          if (!srcSlug || !tgtSlug || srcSlug === tgtSlug) continue;
          if (!validSlugs.has(srcSlug) || !validSlugs.has(tgtSlug)) continue;
          let srcId = conceptId(projectId, srcSlug);
          let tgtId = conceptId(projectId, tgtSlug);
          if (SYMMETRIC_RELATIONS.has(e.relation) && srcId > tgtId) {
            [srcId, tgtId] = [tgtId, srcId];
          }
          upsertEdge(
            projectId,
            srcId,
            tgtId,
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
        error: chunkErrorSummary,
      });
    })();
    processed++;
  }

  // After all materials: embed newly-created concepts. Recompute the computed
  // similarity edges only when something was actually (re-)extracted this run
  // — a no-op build (every material skipped) leaves the concept/edge set
  // unchanged, so recomputing would just delete and re-insert identical
  // similarity edges for nothing. The similarity matrix depends only on the
  // concept/edge set, which only changes when a material is (re-)extracted.
  await embedMissingConcepts(projectId, newConceptIds);
  if (processed > 0 || opts.force) computeSimilarityEdges(projectId);
  const totalEdges = listEdgesForProject(projectId).length;

  return {
    processed,
    concepts: listConceptsForProject(projectId).length,
    edges: totalEdges,
    skipped,
    errors,
  };
  } finally {
    // Clear the progress row so a stale bar never lingers into the next view.
    if (totalChunks > 0) clearBuildProgress(projectId);
  }
}