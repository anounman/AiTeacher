import assert from "node:assert/strict";
import test from "node:test";
import { createAnswerInsightCollector } from "./answer-insights";

test("records distinct trusted activity labels in the order they occurred", () => {
  const collector = createAnswerInsightCollector();

  collector.recordStatus("searching-materials", "searching your materials…");
  collector.recordStatus("found-sources", "found 2 relevant passages in your materials…");
  collector.recordStatus("thinking", "thinking…");
  collector.recordStatus("thinking", "thinking…");

  assert.deepEqual(collector.activities(), [
    { phase: "searching-materials", label: "searching your materials…", ordinal: 0 },
    { phase: "found-sources", label: "found 2 relevant passages in your materials…", ordinal: 1 },
    { phase: "thinking", label: "thinking…", ordinal: 2 },
  ]);
});

test("collects only concrete grounding facts", () => {
  const collector = createAnswerInsightCollector();

  collector.recordSources([
    { materialId: "slides", title: "Lecture slides", ordinal: 3, snippet: "Chen notation" },
    { materialId: "slides", title: "Lecture slides", ordinal: 4, snippet: "Cardinality" },
    { materialId: "book", title: "Course book", ordinal: 1, snippet: "Relations" },
  ]);
  collector.markWebUsed();
  collector.markNotationUsed();

  assert.deepEqual(collector.grounding(), {
    materialIds: ["slides", "book"],
    sourceCount: 3,
    usedNotation: true,
    usedWeb: true,
  });
});
