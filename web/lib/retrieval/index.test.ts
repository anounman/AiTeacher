import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEvidenceContext,
  reciprocalRankFusion,
  scoreChunks,
  toFtsQuery,
  type ChunkEmb,
} from "./index";

function chunk(materialId: string, ordinal: number, text: string, emb: number[]): ChunkEmb {
  return {
    materialId,
    ordinal,
    text,
    materialTitle: materialId,
    embedding: Buffer.from(new Float32Array(emb).buffer),
  };
}
function vec(x: number, y: number): Float32Array {
  const v = new Float32Array([x, y]);
  const n = Math.hypot(x, y) || 1;
  v[0] /= n; v[1] /= n;
  return v;
}

test("scoreChunks ranks by cosine, applies floor, sorts desc", () => {
  const q = vec(1, 0);
  const chunks = [
    chunk("m1", 0, "low", [0, 1]),     // sim 0 → below floor
    chunk("m1", 1, "mid", [0.3, 0.95]), // sim ~0.3 → above floor
    chunk("m2", 0, "high", [1, 0.05]),  // sim ~0.998 → top
  ];
  const scored = scoreChunks(q, chunks, { floor: 0.22 });
  assert.equal(scored.length, 2); // the 0-sim chunk filtered out
  assert.equal(scored[0].c.materialId, "m2");
  assert.equal(scored[1].c.materialId, "m1");
  assert.ok(scored[0].sim >= scored[1].sim);
  // No-mastery baseline: score === sim.
  assert.ok(Math.abs(scored[0].score - scored[0].sim) < 1e-6);
});

test("scoreChunks default floor filters weak matches", () => {
  const q = vec(1, 0);
  const chunks = [chunk("m1", 0, "x", [0.1, 0.995])]; // sim ~0.1
  assert.equal(scoreChunks(q, chunks).length, 0);
});

test("RRF promotes overlap and keeps lexical-only results", () => {
  const ranked = reciprocalRankFusion([
    ["semantic-only", "both", "third"],
    ["both", "lexical-only"],
  ]);
  assert.equal(ranked[0]?.id, "both");
  assert.ok(ranked.some(({ id }) => id === "lexical-only"));
});

test("FTS query is punctuation-safe and removes filler words", () => {
  assert.equal(toFtsQuery('Explain "Euler-Lagrange" and lambda_2, please'), '"euler-lagrange" OR "lambda_2"');
});

test("evidence context binds page-aware markers and treats excerpts as data", () => {
  const context = buildEvidenceContext({
    materials: [{ title: "Lecture notes" }],
    sources: [{
      sourceId: "src_c1",
      chunkId: "c1",
      materialId: "m1",
      title: "Lecture notes",
      snippet: "Energy is conserved in this closed system.",
      ordinal: 2,
      page: 7,
    }],
  });
  assert.match(context, /\[S:src_c1\]/);
  assert.match(context, /page=7/);
  assert.match(context, /untrusted data/i);
});

test("empty retrieval context requires an honest abstention", () => {
  const context = buildEvidenceContext({ materials: [{ title: "Notes" }], sources: [] });
  assert.match(context, /I can't find that in your uploaded materials/);
  assert.match(context, /Do not fill the gap/);
});

test("scoreChunks with no eligible chunks returns []", () => {
  const q = vec(1, 0);
  assert.equal(scoreChunks(q, []).length, 0);
});

test("scoreChunks: slipping-concept chunk boosted over equal-sim no-concept chunk", () => {
  const q = vec(1, 0);
  const chunks = [
    chunk("m1", 0, "A", [0.8, 0.6]),
    chunk("m2", 0, "B", [0.8, 0.6]), // same sim as A
  ];
  const masteryByConcept = new Map([["c1", 0.2]]); // slipping
  const conceptsForChunk = new Map([
    ["m1:0", [{ conceptId: "c1", label: "Eigenvalue" }]],
    // m2:0 maps to no concept → neutral
  ]);
  const scored = scoreChunks(q, chunks, { masteryByConcept, conceptsForChunk });
  const a = scored.find((s) => s.c.materialId === "m1")!;
  const b = scored.find((s) => s.c.materialId === "m2")!;
  assert.ok(a.score > b.score, "slipping-concept chunk should outrank neutral");
  assert.ok(Math.abs(b.score - b.sim) < 1e-6, "neutral chunk: score === sim");
  // boost = 0.15 * (1 - 0.2) = 0.12
  assert.ok(Math.abs(a.score - (a.sim + 0.12)) < 1e-6);
});

test("scoreChunks: strong-concept chunk gets a tiny boost; untested is neutral", () => {
  const q = vec(1, 0);
  const chunks = [
    chunk("m1", 0, "A", [0.9, 0.44]),
    chunk("m2", 0, "B", [0.9, 0.44]),
  ];
  const masteryByConcept = new Map([
    ["c1", 0.9],  // strong (reviewed)
    // c2 untested: absent from masteryByConcept (no reviewed linked cards)
  ]);
  const conceptsForChunk = new Map([
    ["m1:0", [{ conceptId: "c1", label: "Strong" }]],
    ["m2:0", [{ conceptId: "c2", label: "Untested" }]],
  ]);
  const scored = scoreChunks(q, chunks, { masteryByConcept, conceptsForChunk });
  const a = scored.find((s) => s.c.materialId === "m1")!;
  const b = scored.find((s) => s.c.materialId === "m2")!;
  // strong boost = 0.15 * (1 - 0.9) = 0.015
  assert.ok(Math.abs(a.score - (a.sim + 0.015)) < 1e-6);
  assert.ok(Math.abs(b.score - b.sim) < 1e-6, "untested concept → neutral");
});
