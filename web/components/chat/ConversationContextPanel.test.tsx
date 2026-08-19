import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationContextPanel } from "./ConversationContextPanel";

test("renders the conversation artifact and source index", () => {
  const markup = renderToStaticMarkup(
    <ConversationContextPanel
      variant="rail"
      context={{
        artifacts: [
          { id: "document", kind: "document", label: "Revision notes", messageId: "m1" },
          { id: "diagram", kind: "diagram", label: "Diagram", messageId: "m2" },
        ],
        sources: [
          { materialId: "slides", title: "Lecture slides", citationCount: 2, messageId: "m2" },
        ],
      }}
      onSelectArtifact={() => {}}
      onSelectSource={() => {}}
    />,
  );

  assert.match(markup, /Artifacts <span[^>]*>2<\/span>/);
  assert.match(markup, /Revision notes/);
  assert.match(markup, /Mermaid diagram/);
  assert.match(markup, /Sources <span[^>]*>1<\/span>/);
  assert.match(markup, /Lecture slides/);
  assert.match(markup, /2 citations/);
});

test("renders helpful empty section states", () => {
  const markup = renderToStaticMarkup(
    <ConversationContextPanel
      variant="sheet"
      context={{ artifacts: [], sources: [] }}
      onSelectArtifact={() => {}}
      onSelectSource={() => {}}
    />,
  );

  assert.match(markup, /No generated artifacts yet\./);
  assert.match(markup, /No course sources cited yet\./);
});
