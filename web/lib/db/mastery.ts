// DB access for the SP4 mastery layer. Pure queries + FSRS retrievability
// aggregation; no embedding, no HTTP. Mastery math lives in lib/mastery/model.

import { db } from "@/lib/db/index";
import { getCardScheduling } from "@/lib/db/reviews";
import {
  cardRetrievability,
  aggregateMastery,
  masteryBand,
  type Band,
} from "@/lib/mastery/model";
import type { CardScheduling } from "@/lib/db/schema";

export interface ConceptMastery {
  mastery: number | null;
  band: Band;
  reviewedCards: number;
  totalCards: number;
  lastReviewed: number | null;
}

export function upsertCardConcept(cardId: string, conceptId: string, score: number): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO card_concepts (card_id, concept_id, score, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(card_id, concept_id) DO UPDATE SET score = excluded.score`,
  ).run(cardId, conceptId, score, now);
}

export function linkedConceptsForCard(cardId: string): { conceptId: string; label: string; score: number }[] {
  return db
    .prepare(
      `SELECT cc.concept_id AS conceptId, c.label AS label, cc.score AS score
       FROM card_concepts cc JOIN concepts c ON c.id = cc.concept_id
       WHERE cc.card_id = ? ORDER BY cc.score DESC`,
    )
    .all(cardId) as { conceptId: string; label: string; score: number }[];
}

// Per-concept mastery for a whole project, in one pass. Joins card_concepts →
// card_scheduling and aggregates retrievability per concept. Concepts with no
// reviewed linked cards still appear (reviewedCards=0 → untested); concepts
// with no card_concepts rows are absent (the caller treats absent as unknown).
export function conceptMasteryForProject(projectId: string, now: number): Map<string, ConceptMastery> {
  const rows = db
    .prepare(
      `SELECT cc.concept_id AS conceptId,
              c.label AS label,
              s.stability AS stability,
              s.last_review AS lastReview
       FROM card_concepts cc
       JOIN concepts c ON c.id = cc.concept_id
       LEFT JOIN card_scheduling s ON s.card_id = cc.card_id
       WHERE c.project_id = ?`,
    )
    .all(projectId) as { conceptId: string; label: string; stability: number | null; lastReview: number | null }[];

  const byConcept = new Map<string, { rs: number[]; total: number; lastReviewed: number | null }>();
  for (const r of rows) {
    let entry = byConcept.get(r.conceptId);
    if (!entry) {
      entry = { rs: [], total: 0, lastReviewed: null };
      byConcept.set(r.conceptId, entry);
    }
    entry.total++;
    if (r.stability != null && r.lastReview != null) {
      const R = cardRetrievability({ stability: r.stability, last_review: r.lastReview }, now);
      if (Number.isFinite(R)) entry.rs.push(R);
      if (r.lastReview != null && (entry.lastReviewed == null || r.lastReview > entry.lastReviewed)) {
        entry.lastReviewed = r.lastReview;
      }
    }
  }

  const out = new Map<string, ConceptMastery>();
  for (const [conceptId, e] of byConcept) {
    const mastery = aggregateMastery(e.rs);
    out.set(conceptId, {
      mastery,
      band: masteryBand(mastery, e.rs.length, e.total),
      reviewedCards: e.rs.length,
      totalCards: e.total,
      lastReviewed: e.lastReviewed,
    });
  }
  return out;
}

export function conceptMastery(conceptId: string, now: number): ConceptMastery | undefined {
  // Resolve the project from the concept, then reuse the project query (small N).
  const row = db.prepare("SELECT project_id FROM concepts WHERE id = ?").get(conceptId) as { project_id: string } | undefined;
  if (!row) return undefined;
  return conceptMasteryForProject(row.project_id, now).get(conceptId);
}

// The card's OWN retrievability band — used by StudySession card coloring.
// A card with no scheduling row (new) → untested. Never "unknown" (that band
// is concept-level "no linked cards").
export function cardMastery(cardId: string, now: number): { mastery: number | null; band: Band } | null {
  const sched = getCardScheduling(cardId) as CardScheduling | undefined;
  if (!sched) return { mastery: null, band: "untested" };
  const R = cardRetrievability({ stability: sched.stability, last_review: sched.last_review }, now);
  const mastery = Number.isFinite(R) ? Math.min(1, Math.max(0, R)) : 0;
  return { mastery, band: masteryBand(mastery, 1, 1) };
}

// Map chunk keys → the concepts that cite them, via concept_sources. Key is
// `${materialId}:${ordinal}` (the same key the chat retriever uses for chunks).
export function chunksToConcepts(
  materialId: string,
  ordinals: number[],
): Map<string, { conceptId: string; label: string }[]> {
  const out = new Map<string, { conceptId: string; label: string }[]>();
  if (ordinals.length === 0) return out;
  const placeholders = ordinals.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT cs.material_id AS materialId, cs.ordinal AS ordinal,
              cs.concept_id AS conceptId, c.label AS label
       FROM concept_sources cs JOIN concepts c ON c.id = cs.concept_id
       WHERE cs.material_id = ? AND cs.ordinal IN (${placeholders})`,
    )
    .all(materialId, ...ordinals) as { materialId: string; ordinal: number; conceptId: string; label: string }[];
  for (const r of rows) {
    const key = `${r.materialId}:${r.ordinal}`;
    const arr = out.get(key) ?? [];
    arr.push({ conceptId: r.conceptId, label: r.label });
    out.set(key, arr);
  }
  return out;
}