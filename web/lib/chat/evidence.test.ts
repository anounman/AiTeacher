import assert from "node:assert/strict";
import test from "node:test";
import type { Material } from "@/lib/db/schema";
import { resolveEvidence } from "./evidence";

test("uses the source page when the cited PDF page exists", () => {
  const evidence = resolveEvidence(
    { materialId: "m1", title: "Slides", snippet: "The determinant is…", ordinal: 3, page: 7 },
    { id: "m1", title: "Slides", source_type: "pdf" } as Material,
  );

  assert.equal(evidence.pageAvailable, true);
  assert.equal(evidence.pageImageUrl, "/api/materials/m1/evidence?page=7");
});

test("falls back to a passage when a source has no page", () => {
  const evidence = resolveEvidence(
    { materialId: "m2", title: "Article", snippet: "A normalized relation…", ordinal: 1, page: null },
    { id: "m2", title: "Article", source_type: "url" } as Material,
  );

  assert.equal(evidence.pageAvailable, false);
  assert.equal(evidence.pageImageUrl, null);
});
