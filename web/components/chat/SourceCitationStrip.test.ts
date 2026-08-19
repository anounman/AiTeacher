import assert from "node:assert/strict";
import test from "node:test";
import { dedupeSources } from "./SourceCitationStrip";

test("keeps one citation chip for each material, excerpt, and page", () => {
  const sources = dedupeSources([
    { materialId: "slides", title: "Slides", snippet: "Determinants", ordinal: 2, page: 4 },
    { materialId: "slides", title: "Slides", snippet: "Determinants", ordinal: 2, page: 4 },
    { materialId: "slides", title: "Slides", snippet: "Eigenvalues", ordinal: 3, page: 4 },
    { materialId: "notes", title: "Notes", snippet: "Matrices", ordinal: 2, page: null },
  ]);

  assert.deepEqual(sources.map(({ materialId, ordinal, page }) => ({ materialId, ordinal, page })), [
    { materialId: "slides", ordinal: 2, page: 4 },
    { materialId: "slides", ordinal: 3, page: 4 },
    { materialId: "notes", ordinal: 2, page: null },
  ]);
});
