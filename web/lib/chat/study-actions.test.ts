import assert from "node:assert/strict";
import test from "node:test";
import { suggestStudyActions, type StudyActionInput } from "./study-actions";

// A content fixture with MANY signals: math, a comparison clause, a
// low-mastery mentioned concept, and source-backed content. Used to prove the
// engine never returns more than two actions regardless of how many signals fire.
const richFixture: StudyActionInput = {
  content:
    "The derivative f'(x) = 2x, unlike the integral which accumulates area. " +
    "Conflict serializability holds when the schedule graph is acyclic. " +
    "According to the lecture slides, normalization reduces redundancy.",
  sources: [{ materialId: "m1", title: "Slides", snippet: "normalization", ordinal: 1, page: 7 }],
  concepts: [{ label: "conflict serializability", band: "needs-practice" }],
};

test("offers a formula explanation and worked example for mathematical content", () => {
  const actions = suggestStudyActions({ content: "The derivative is f'(x) = 2x.", sources: [], concepts: [] });
  assert.deepEqual(actions.map((action) => action.id), ["explain-formula", "worked-example"]);
});

test("prefers a short quiz for a low-mastery mentioned concept", () => {
  const actions = suggestStudyActions({
    content: "A transaction schedule is conflict serializable when its graph is acyclic.",
    sources: [],
    concepts: [{ label: "conflict serializability", band: "needs-practice" }],
  });
  assert.equal(actions[0]?.id, "quiz-me");
});

test("never returns more than two actions", () => {
  assert.ok(suggestStudyActions(richFixture).length <= 2);
});

test("compare-concepts is suggested for explicit contrast language", () => {
  const actions = suggestStudyActions({
    content: "Mitosis is used by body cells, whereas meiosis produces gametes for reproduction.",
    sources: [],
    concepts: [],
  });
  assert.ok(actions.some((a) => a.id === "compare-concepts"), "expected a compare-concepts action");
});

test("inspect-source is suggested when the answer is source-backed", () => {
  const actions = suggestStudyActions({
    content:
      "Normalization is the process of organizing columns and tables to reduce redundancy. " +
      "The slides describe first, second, and third normal forms in detail.",
    sources: [{ materialId: "m1", title: "Slides", snippet: "normalization", ordinal: 1, page: 7 }],
    concepts: [],
  });
  assert.ok(actions.some((a) => a.id === "inspect-source"), "expected an inspect-source action");
});

test("returns no actions for a short acknowledgement", () => {
  assert.deepEqual(suggestStudyActions({ content: "Got it, thanks!", sources: [], concepts: [] }), []);
});

test("returns no actions for empty or whitespace content", () => {
  assert.deepEqual(suggestStudyActions({ content: "   \n  ", sources: [], concepts: [] }), []);
});

test("high-mastery concepts do not trigger a quiz", () => {
  const actions = suggestStudyActions({
    content: "Conflict serializability holds when the precedence graph is acyclic.",
    sources: [],
    concepts: [{ label: "conflict serializability", band: "mastered" }],
  });
  assert.ok(!actions.some((a) => a.id === "quiz-me"), "must not quiz a mastered concept");
});

test("a 'new' band concept also triggers a quiz", () => {
  const actions = suggestStudyActions({
    content: "Conflict serializability holds when the precedence graph is acyclic.",
    sources: [],
    concepts: [{ label: "conflict serializability", band: "new" }],
  });
  assert.equal(actions[0]?.id, "quiz-me");
});

test("every returned selectedText is a non-empty substring of content", () => {
  const inputs: StudyActionInput[] = [
    richFixture,
    { content: "The derivative is f'(x) = 2x.", sources: [], concepts: [] },
    {
      content: "Mitosis is used by body cells, whereas meiosis produces gametes for reproduction.",
      sources: [],
      concepts: [],
    },
    {
      content:
        "Normalization reduces redundancy. The slides describe first, second, and third normal forms.",
      sources: [{ materialId: "m1", title: "Slides", snippet: "normalization", ordinal: 1, page: 7 }],
      concepts: [],
    },
    {
      content: "A transaction schedule is conflict serializable when its graph is acyclic.",
      sources: [],
      concepts: [{ label: "conflict serializability", band: "needs-practice" }],
    },
  ];
  for (const input of inputs) {
    const actions = suggestStudyActions(input);
    for (const action of actions) {
      assert.ok(action.selectedText.length > 0, "selectedText must be non-empty");
      assert.ok(
        input.content.indexOf(action.selectedText) !== -1,
        `selectedText "${action.selectedText}" must occur in content`,
      );
    }
  }
});

test("returns no actions for content that looks like an error", () => {
  assert.deepEqual(
    suggestStudyActions({ content: "Error: could not retrieve the answer from the model.", sources: [], concepts: [] }),
    [],
  );
});

test("stable action ids only", () => {
  const actions = suggestStudyActions(richFixture);
  const valid = new Set(["explain-formula", "worked-example", "compare-concepts", "quiz-me", "inspect-source"]);
  for (const a of actions) assert.ok(valid.has(a.id), `unexpected id ${a.id}`);
});