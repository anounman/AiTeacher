import { db } from "./index";
import type {
  Concept,
  ConceptEdge,
  MaterialExtraction,
  MaterialExtractionStatus,
  EdgeConfidence,
} from "./schema";

// Deterministic IDs make extraction idempotent and dedupe a concept across
// chunks/materials. A concept's id is `${projectId}#${slug}`; an edge's id is
// `${projectId}#${source}#${target}#${relation}`; a source row's id is
// `${conceptId}#${materialId}#${ordinal}`. Re-extracting the same material
// produces the same ids, so INSERT ... ON CONFLICT merges cleanly.

export function conceptId(projectId: string, slug: string): string {
  return `${projectId}#${slug}`;
}

export function edgeId(projectId: string, source: string, target: string, relation: string): string {
  return `${projectId}#${source}#${target}#${relation}`;
}

export function conceptSourceId(conceptId: string, materialId: string, ordinal: number): string {
  return `${conceptId}#${materialId}#${ordinal}`;
}

// Insert the concept if absent, else update label/description. Returns whether
// the row was created (not just changed) so the extractor can collect only
// genuinely-new concept ids for embedding. We SELECT first rather than rely on
// `changes`, which is 1 for both insert and a real update.
export function upsertConcept(
  projectId: string,
  slug: string,
  label: string,
  description: string,
): { id: string; created: boolean } {
  const id = conceptId(projectId, slug);
  const existing = db.prepare("SELECT id FROM concepts WHERE id = ?").get(id);
  const now = Date.now();
  if (existing) {
    db.prepare(
      "UPDATE concepts SET label = ?, description = ?, updated_at = ? WHERE id = ?",
    ).run(label, description, now, id);
    return { id, created: false };
  }
  db.prepare(
    `INSERT INTO concepts (id, project_id, label, slug, description, embedding, source_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
  ).run(id, projectId, label, slug, description, now, now);
  return { id, created: true };
}

export function getProjectConceptIds(projectId: string): string[] {
  const rows = db.prepare("SELECT id FROM concepts WHERE project_id = ?").all(projectId) as { id: string }[];
  return rows.map((r) => r.id);
}

export function listConceptsForProject(projectId: string): Concept[] {
  return db
    .prepare("SELECT * FROM concepts WHERE project_id = ? ORDER BY label ASC")
    .all(projectId) as Concept[];
}

// Only concepts that have an embedding (needed for the similarity post-pass).
export function listConceptEmbeddingsForProject(projectId: string): { id: string; embedding: Buffer }[] {
  return db
    .prepare("SELECT id, embedding FROM concepts WHERE project_id = ? AND embedding IS NOT NULL")
    .all(projectId) as { id: string; embedding: Buffer }[];
}

export function updateConceptEmbedding(id: string, embedding: Buffer): void {
  db.prepare("UPDATE concepts SET embedding = ?, updated_at = ? WHERE id = ?").run(
    embedding, Date.now(), id,
  );
}

// Recompute source_count for every concept in a project from concept_sources.
// One correlated UPDATE — cheaper than a per-concept COUNT, and correct after
// bulk re-inserts/deletes during extraction.
export function recomputeConceptSourceCounts(projectId: string): void {
  db.prepare(
    `UPDATE concepts SET source_count = (
       SELECT COUNT(*) FROM concept_sources WHERE concept_sources.concept_id = concepts.id
     ) WHERE project_id = ?`,
  ).run(projectId);
}

// Insert a provenance row (concept←material/ordinal). INSERT OR IGNORE: a
// re-extract that re-finds the same concept in the same chunk is a no-op.
export function upsertConceptSource(
  conceptId: string,
  materialId: string,
  ordinal: number,
  snippet: string | null,
): void {
  const id = conceptSourceId(conceptId, materialId, ordinal);
  db.prepare(
    `INSERT OR IGNORE INTO concept_sources (id, concept_id, material_id, ordinal, snippet, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, conceptId, materialId, ordinal, snippet, Date.now());
}

// Drop all provenance rows for a material before re-extracting it, so chunks
// it no longer contains a concept in don't linger. Concepts themselves persist
// (a concept shared with another material/surviving chunk stays).
export function deleteConceptSourcesForMaterial(materialId: string): void {
  db.prepare("DELETE FROM concept_sources WHERE material_id = ?").run(materialId);
}

// Insert/merge an edge. On conflict (same project/source/target/relation),
// keep the higher confidence_score and its accompanying confidence/evidence —
// a strong EXTRACTED edge from one chunk wins over a weaker INFERRED from
// another. confidence_score may be null only for semantically_similar_to,
// which always passes a real number, so the CASE's NULL comparison never
// fires for the LLM edges.
export function upsertEdge(
  projectId: string,
  source: string,
  target: string,
  relation: string,
  confidence: EdgeConfidence,
  confidenceScore: number,
  evidence: string | null,
): void {
  const id = edgeId(projectId, source, target, relation);
  db.prepare(
    `INSERT INTO concept_edges
       (id, project_id, source_concept, target_concept, relation, confidence, confidence_score, evidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       confidence_score = CASE WHEN excluded.confidence_score > concept_edges.confidence_score
                               THEN excluded.confidence_score ELSE concept_edges.confidence_score END,
       confidence = CASE WHEN excluded.confidence_score > concept_edges.confidence_score
                         THEN excluded.confidence ELSE concept_edges.confidence END,
       evidence = CASE WHEN excluded.confidence_score > concept_edges.confidence_score
                       THEN excluded.evidence ELSE concept_edges.evidence END`,
  ).run(id, projectId, source, target, relation, confidence, confidenceScore, evidence, Date.now());
}

export function listEdgesForProject(projectId: string): ConceptEdge[] {
  return db
    .prepare("SELECT * FROM concept_edges WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as ConceptEdge[];
}

// Wipe the computed similarity edges before recomputing them, so dropped
// concept pairs don't keep a stale semantically_similar_to edge.
export function deleteSemanticSimilarityEdgesForProject(projectId: string): void {
  db.prepare(
    "DELETE FROM concept_edges WHERE project_id = ? AND relation = 'semantically_similar_to'",
  ).run(projectId);
}

// Pairs of concepts already linked by an LLM edge (any relation except
// semantically_similar_to), both directions, as a sorted "a b" string for
// O(1) lookup. The similarity post-pass skips these so it doesn't add a
// redundant semantically_similar_to edge next to an explicit relation.
export function llmLinkedPairs(projectId: string): Set<string> {
  const rows = db
    .prepare(
      "SELECT source_concept, target_concept FROM concept_edges WHERE project_id = ? AND relation != 'semantically_similar_to'",
    )
    .all(projectId) as { source_concept: string; target_concept: string }[];
  const set = new Set<string>();
  for (const r of rows) {
    const [a, b] = r.source_concept < r.target_concept ? [r.source_concept, r.target_concept] : [r.target_concept, r.source_concept];
    set.add(`${a} ${b}`);
  }
  return set;
}

export function getMaterialExtraction(materialId: string): MaterialExtraction | undefined {
  return db.prepare("SELECT * FROM material_extractions WHERE material_id = ?").get(materialId) as
    | MaterialExtraction
    | undefined;
}

export function upsertMaterialExtraction(
  materialId: string,
  projectId: string,
  status: MaterialExtractionStatus,
  opts?: { contentHash?: string; conceptCount?: number; edgeCount?: number; error?: string },
): void {
  const extractedAt = status === "ready" || status === "error" ? Date.now() : null;
  db.prepare(
    `INSERT INTO material_extractions
       (material_id, project_id, status, content_hash, concept_count, edge_count, error, extracted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(material_id) DO UPDATE SET
       status = excluded.status,
       content_hash = CASE WHEN excluded.content_hash IS NULL
                           THEN material_extractions.content_hash ELSE excluded.content_hash END,
       concept_count = CASE WHEN excluded.concept_count = 0
                            THEN material_extractions.concept_count ELSE excluded.concept_count END,
       edge_count = CASE WHEN excluded.edge_count = 0
                         THEN material_extractions.edge_count ELSE excluded.edge_count END,
       error = excluded.error,
       extracted_at = CASE WHEN excluded.extracted_at IS NULL
                           THEN material_extractions.extracted_at ELSE excluded.extracted_at END`,
  ).run(
    materialId, projectId, status,
    opts?.contentHash ?? null,
    opts?.conceptCount ?? 0,
    opts?.edgeCount ?? 0,
    opts?.error ?? null,
    extractedAt,
  );
}

export function listExtractionsForProject(projectId: string): MaterialExtraction[] {
  return db
    .prepare("SELECT * FROM material_extractions WHERE project_id = ?")
    .all(projectId) as MaterialExtraction[];
}

// DISTINCT concept_id count for a material — for the per-material chip and
// the extraction's concept_count field.
export function countConceptsForMaterial(materialId: string): number {
  const row = db
    .prepare("SELECT COUNT(DISTINCT concept_id) AS n FROM concept_sources WHERE material_id = ?")
    .get(materialId) as { n: number };
  return row.n;
}

// Set edge_count on every ready extraction for a project to the project total.
// Called once after the full project pass + similarity recomputation.
export function setEdgeCountsForProject(projectId: string, total: number): void {
  db.prepare(
    "UPDATE material_extractions SET edge_count = ? WHERE project_id = ? AND status = 'ready'",
  ).run(total, projectId);
}

export interface ConceptDetail {
  concept: { id: string; label: string; slug: string; description: string | null; sourceCount: number };
  sources: { materialId: string; title: string; ordinal: number; snippet: string | null }[];
  neighbors: {
    id: string;
    label: string;
    relation: string;
    confidence: string;
    score: number | null;
    direction: "out" | "in";
  }[];
}

// One concept + its provenance (which material/chunk it came from) + its
// neighbors (edges both directions, with the other concept's label). Serves the
// /graph detail panel. Returns undefined when the concept id doesn't exist.
export function getConceptDetail(id: string): ConceptDetail | undefined {
  const concept = db
    .prepare("SELECT id, label, slug, description, source_count FROM concepts WHERE id = ?")
    .get(id) as
    | { id: string; label: string; slug: string; description: string | null; source_count: number }
    | undefined;
  if (!concept) return undefined;

  const sources = db
    .prepare(
      `SELECT cs.material_id AS materialId, m.title, cs.ordinal, cs.snippet
       FROM concept_sources cs
       JOIN materials m ON m.id = cs.material_id
       WHERE cs.concept_id = ?
       ORDER BY m.title ASC, cs.ordinal ASC`,
    )
    .all(id) as { materialId: string; title: string; ordinal: number; snippet: string | null }[];

  const outEdges = db
    .prepare(
      `SELECT e.target_concept AS id, c.label, e.relation, e.confidence, e.confidence_score AS score, 'out' AS direction
       FROM concept_edges e JOIN concepts c ON c.id = e.target_concept
       WHERE e.source_concept = ?`,
    )
    .all(id) as { id: string; label: string; relation: string; confidence: string; score: number | null; direction: "out" }[];
  const inEdges = db
    .prepare(
      `SELECT e.source_concept AS id, c.label, e.relation, e.confidence, e.confidence_score AS score, 'in' AS direction
       FROM concept_edges e JOIN concepts c ON c.id = e.source_concept
       WHERE e.target_concept = ?`,
    )
    .all(id) as { id: string; label: string; relation: string; confidence: string; score: number | null; direction: "in" }[];

  return {
    concept: {
      id: concept.id,
      label: concept.label,
      slug: concept.slug,
      description: concept.description,
      sourceCount: concept.source_count,
    },
    sources,
    neighbors: [...outEdges, ...inEdges],
  };
}