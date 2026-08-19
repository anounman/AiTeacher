import assert from "node:assert/strict";
import test from "node:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as MarkdownModule from "./Markdown";

const PreBlock = (
  MarkdownModule as typeof MarkdownModule & {
    PreBlock?: (props: { children?: ReactNode; "data-language"?: string; streaming?: boolean }) => ReactNode;
  }
).PreBlock;

function renderFence(language: string, source: string): string {
  assert.equal(typeof PreBlock, "function");
  if (!PreBlock) return "";
  return renderToStaticMarkup(
    <PreBlock data-language={language}>
      <code>{source}</code>
    </PreBlock>,
  );
}

const nativeArtifactSource = `{
  "schema": "studygpt.artifact",
  "version": 1,
  "kind": "table",
  "title": "Selection pushdown",
  "data": {
    "columns": ["Rule"],
    "rows": [["Push filters down"]]
  }
}`;

const nativeArtifactFence = `\`\`\`artifact
${nativeArtifactSource}
\`\`\``;

test("routes a native artifact fence into platform-owned chrome", () => {
  const markup = renderFence("artifact", nativeArtifactSource);

  assert.match(markup, /Data table/);
  assert.match(markup, /data-selection-excluded/);
  assert.doesNotMatch(markup, /custom visualization/);
});

test("routes saved HTML from an artifact fence to the legacy sandbox", () => {
  const markup = renderFence("artifact", "<!doctype html><html><body>Legacy</body></html>");

  assert.match(markup, /custom visualization/);
  assert.match(markup, /<iframe/);
});

test("routes an artifact-html fence to the legacy sandbox", () => {
  const markup = renderFence("artifact-html", "<div>Legacy</div>");

  assert.match(markup, /custom visualization/);
  assert.match(markup, /<iframe/);
});

test("renders malformed artifact JSON in a compact fallback", () => {
  const markup = renderFence("artifact", "{invalid");

  assert.match(markup, /Couldn(?:&#x27;|')t render artifact/);
  assert.match(markup, /<details/);
  assert.doesNotMatch(markup, /<details open/);
  assert.match(markup, /\{invalid/);
});

test("routes a direct Mermaid fence through the Mermaid renderer", () => {
  const markup = renderFence("mermaid", "graph TD\n  A --> B");

  assert.match(markup, /Diagram/);
  assert.match(markup, /rendering diagram/);
  assert.doesNotMatch(markup, /language-mermaid/);
});
