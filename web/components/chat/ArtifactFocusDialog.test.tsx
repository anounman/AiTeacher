import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactFocusDialogBody } from "./ArtifactFocusDialog";
import { Dialog } from "@/components/ui/Dialog";

test("renders an accessible artifact focus dialog body with markdown content", () => {
  const markup = renderToStaticMarkup(
    <Dialog open>
      <ArtifactFocusDialogBody
        kind="document"
        title="Revision notes"
        content={"# Eigenvalues\n\nA focused explanation."}
      />
    </Dialog>,
  );

  assert.match(markup, /Revision notes/);
  assert.match(markup, /Focused document/);
  assert.match(markup, /aria-label="Close focus view"/);
});
