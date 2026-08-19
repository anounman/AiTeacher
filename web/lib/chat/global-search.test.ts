import assert from "node:assert/strict";
import test from "node:test";
import { rankGlobalSearch, type GlobalSearchInput } from "./global-search";

function fixture(overrides: Partial<GlobalSearchInput> = {}): GlobalSearchInput {
  return {
    query: "",
    activeProjectId: null,
    conversations: [
      { id: "c1", title: "Explain determinant" },
      { id: "c2", title: "Normalization notes" },
      { id: "c3", title: "Matrix transformations" },
    ],
    messages: [
      {
        id: "m1",
        conversationId: "c1",
        role: "assistant",
        content: "A determinant describes how a transformation scales area.",
      },
      {
        id: "m2",
        conversationId: "c2",
        role: "assistant",
        kind: "document",
        content: "# Normalization worksheet\n\nPractice normalizing each relation.",
      },
      {
        id: "m3",
        conversationId: "c2",
        role: "user",
        content: "How does third normal form avoid anomalies?",
      },
      {
        id: "m4",
        conversationId: "c3",
        role: "assistant",
        content: "The determinant measures scaling in a matrix transformation.",
      },
    ],
    materials: [
      { id: "mat-active", projectId: "p1", title: "Normalization", text: "Active project database notes." },
      { id: "mat-global", projectId: "p2", title: "Normalization", text: "Another course's notes." },
    ],
    concepts: [
      { id: "concept-1", projectId: "p1", label: "Third normal form", description: "A normal form that removes transitive dependencies." },
    ],
    overlays: [
      { id: "o1", conversationId: "c1", selectedText: "why determinant…" },
    ],
    ...overrides,
  };
}

test("prefers an active-project material before a similarly named global result", () => {
  const results = rankGlobalSearch(fixture({ query: "normalization", activeProjectId: "p1" }));

  assert.equal(results[0]?.kind, "material");
  assert.equal((results[0] as { projectId: string }).projectId, "p1");
});

test("returns a saved overlay and its source conversation destination", () => {
  const [result] = rankGlobalSearch(fixture({ query: "why determinant", activeProjectId: null }));

  assert.deepEqual(result, {
    kind: "overlay",
    overlayId: "o1",
    conversationId: "c1",
    title: "Explain determinant",
    snippet: "why determinant…",
  });
});

test("keeps exact conversation title matches ahead of message text matches", () => {
  const results = rankGlobalSearch(fixture({ query: "determinant" }));

  const conversationIndex = results.findIndex((result) => result.kind === "conversation" && result.conversationId === "c1");
  const messageIndex = results.findIndex((result) => result.kind === "message" && result.messageId === "m4");
  assert.ok(conversationIndex >= 0);
  assert.ok(messageIndex > conversationIndex);
});

test("returns matching materials with project destinations", () => {
  const [result] = rankGlobalSearch(fixture({ query: "database notes", activeProjectId: "p1" }));

  assert.deepEqual(result, {
    kind: "material",
    materialId: "mat-active",
    projectId: "p1",
    title: "Normalization",
    snippet: "Active project database notes.",
  });
});

test("returns matching concepts with graph destinations", () => {
  const [result] = rankGlobalSearch(fixture({ query: "transitive dependencies", activeProjectId: "p1" }));

  assert.deepEqual(result, {
    kind: "concept",
    conceptId: "concept-1",
    projectId: "p1",
    title: "Third normal form",
    snippet: "A normal form that removes transitive dependencies.",
  });
});

test("derives artifacts through assistant conversation context", () => {
  const [result] = rankGlobalSearch(fixture({ query: "worksheet" }));

  assert.deepEqual(result, {
    kind: "artifact",
    artifactId: "m2:document",
    conversationId: "c2",
    messageId: "m2",
    title: "Normalization worksheet",
    snippet: "Normalization worksheet",
  });
});

test("bounds each kind and the combined result set", () => {
  const materials = Array.from({ length: 12 }, (_, index) => ({
    id: `mat-${index}`,
    projectId: "p1",
    title: `Lecture normalization ${index}`,
    text: "",
  }));
  const results = rankGlobalSearch(fixture({ query: "normalization", materials }));

  assert.equal(results.filter((result) => result.kind === "material").length, 8);
  assert.ok(results.length <= 30);
});
