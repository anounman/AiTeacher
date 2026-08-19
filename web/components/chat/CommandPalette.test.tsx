import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandPaletteBody, movePaletteSelection } from "./CommandPalette";
import { Dialog } from "@/components/ui/Dialog";
import type { GlobalSearchResult } from "@/lib/chat/global-search";

const results: GlobalSearchResult[] = [
  { kind: "conversation", conversationId: "c1", title: "Linear algebra", snippet: "Eigenvalues" },
  { kind: "material", materialId: "m1", projectId: "p1", title: "Lecture slides", snippet: "Matrices" },
  { kind: "concept", conceptId: "p1#basis", projectId: "p1", title: "Basis", snippet: "Independent vectors" },
  { kind: "overlay", overlayId: "o1", conversationId: "c1", title: "Linear algebra", snippet: "Why does this work?" },
  { kind: "artifact", artifactId: "a1", conversationId: "c1", messageId: "msg1", title: "Revision sheet", snippet: "Practice problems" },
];

test("groups every global result kind in an accessible command palette", () => {
  const markup = renderToStaticMarkup(
    <Dialog open>
      <CommandPaletteBody
        query="matrix"
        onQueryChange={() => {}}
        results={results}
        activeIndex={0}
        onActiveIndexChange={() => {}}
        onSelect={() => {}}
      />
    </Dialog>,
  );

  assert.match(markup, /Search everything/);
  assert.match(markup, /Conversations/);
  assert.match(markup, /Materials/);
  assert.match(markup, /Concepts/);
  assert.match(markup, /Saved discussions/);
  assert.match(markup, /Artifacts/);
  assert.match(markup, /aria-selected="true"/);
});

test("cycles command palette selection for arrow-key navigation", () => {
  assert.equal(movePaletteSelection(0, 5, "down"), 1);
  assert.equal(movePaletteSelection(4, 5, "down"), 0);
  assert.equal(movePaletteSelection(0, 5, "up"), 4);
  assert.equal(movePaletteSelection(0, 0, "down"), -1);
});
