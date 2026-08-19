import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerInsights } from "./AnswerInsights";

test("renders a concise answer-preparation timeline and grounding facts", () => {
  const markup = renderToStaticMarkup(
    <AnswerInsights
      activities={[
        { phase: "searching-materials", label: "searching your materials…", ordinal: 0 },
        { phase: "thinking", label: "thinking…", ordinal: 1 },
      ]}
      grounding={{
        materialIds: ["slides"],
        sourceCount: 2,
        usedNotation: true,
        usedWeb: false,
        model: "glm-5.2:cloud",
      }}
    />,
  );

  assert.match(markup, /How this answer was prepared/);
  assert.match(markup, /searching your materials…/);
  assert.match(markup, /2 course passages/);
  assert.match(markup, /course notation/);
  assert.match(markup, /glm-5.2:cloud/);
});
