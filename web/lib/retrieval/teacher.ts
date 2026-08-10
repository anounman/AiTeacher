// Retrieval backed by the teacher service (ARCHITECTURE_V2 §2): Postgres +
// pgvector for dense, Postgres full-text for lexical, fused with RRF over
// there instead of over SQLite here.
//
// What stays on this side is everything that is about *this learner* rather
// than about the corpus: concept tags, mastery bands, per-material caps and
// the context budget. Those read the local study database, which the teacher
// service has no business knowing about.

import { listMaterials } from "@/lib/db";
import { conceptMasteryForProject, chunksToConcepts } from "@/lib/db/mastery";
import type { Band } from "@/lib/mastery/model";
import type { SourceEntry } from "@/lib/db/schema";

const TEACHER_URL = process.env.TEACHER_URL ?? "http://127.0.0.1:8900";
const CONTEXT_BUDGET = 8_000;
const MAX_SOURCES = 10;

interface TeacherEvidence {
  verbatim_quote: string;
  source_id: string;
  document_title: string;
  loc: { page?: number; lines?: [number, number] };
  ordinal: number;
  external_id: string;
  score: number;
}

export class TeacherUnavailable extends Error {}

export async function searchTeacher(opts: {
  projectId: string;
  query: string;
  topK?: number;
}): Promise<TeacherEvidence[]> {
  let res: Response;
  try {
    res = await fetch(`${TEACHER_URL}/knowledge/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: opts.query,
        top_k: opts.topK ?? 30,
        workspace_id: opts.projectId,
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new TeacherUnavailable(String(err));
  }
  if (!res.ok) throw new TeacherUnavailable(`search ${res.status}`);
  const data = (await res.json()) as { evidence?: TeacherEvidence[] };
  return data.evidence ?? [];
}

// Same shape the SQLite path produces, so buildEvidenceContext and every
// consumer of `sources` are unchanged.
function sourceIdFor(chunkId: string): string {
  return `src_${chunkId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export async function retrieveViaTeacher(opts: {
  projectId: string;
  query: string;
  explicitIds: Set<string>;
}): Promise<SourceEntry[]> {
  const evidence = await searchTeacher({ projectId: opts.projectId, query: opts.query });
  if (!evidence.length) return [];

  const materials = listMaterials(opts.projectId);
  const titleById = new Map(materials.map((m) => [m.id, m.title]));

  // Concepts are keyed by (materialId, ordinal) in the study database, which
  // is exactly what the migrated documents kept as external_id + ordinal.
  const ordinalsByMaterial = new Map<string, number[]>();
  for (const hit of evidence) {
    if (!hit.external_id) continue;
    const ordinals = ordinalsByMaterial.get(hit.external_id) ?? [];
    ordinals.push(hit.ordinal);
    ordinalsByMaterial.set(hit.external_id, ordinals);
  }
  const conceptsForChunk = new Map<string, { conceptId: string; label: string }[]>();
  for (const [materialId, ordinals] of ordinalsByMaterial) {
    for (const [key, concepts] of chunksToConcepts(materialId, ordinals)) {
      conceptsForChunk.set(key, concepts);
    }
  }
  const masteryMap = conceptMasteryForProject(opts.projectId, Date.now());

  // Explicitly named materials come first: a learner who says "in slides 4"
  // means that file, and similarity is not the question being asked.
  const ordered = [...evidence].sort((a, b) => {
    const aExplicit = opts.explicitIds.has(a.external_id) ? 1 : 0;
    const bExplicit = opts.explicitIds.has(b.external_id) ? 1 : 0;
    return bExplicit - aExplicit || b.score - a.score;
  });

  const sources: SourceEntry[] = [];
  const perMaterial = new Map<string, number>();
  let chars = 0;
  for (const hit of ordered) {
    const materialId = hit.external_id || hit.source_id.split("#")[0]!;
    const used = perMaterial.get(materialId) ?? 0;
    const limit = opts.explicitIds.has(materialId) ? 8 : 3;
    if (used >= limit) continue;
    if (sources.length >= MAX_SOURCES) break;
    if (chars + hit.verbatim_quote.length > CONTEXT_BUDGET && sources.length) continue;

    const chunkId = hit.source_id;
    const concepts = (conceptsForChunk.get(`${materialId}:${hit.ordinal}`) ?? []).map(
      (concept) => ({
        label: concept.label,
        band: masteryMap.get(concept.conceptId)?.band ?? ("unknown" as Band),
      }),
    );
    perMaterial.set(materialId, used + 1);
    chars += hit.verbatim_quote.length;
    sources.push({
      sourceId: sourceIdFor(chunkId),
      chunkId,
      materialId,
      title: titleById.get(materialId) ?? hit.document_title,
      snippet: hit.verbatim_quote,
      ordinal: hit.ordinal,
      page: hit.loc?.page,
      ...(concepts.length ? { concepts } : {}),
    } satisfies SourceEntry);
  }
  return sources;
}
