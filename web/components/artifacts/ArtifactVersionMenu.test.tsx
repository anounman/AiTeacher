import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactVersionMenu, FIXED_TRANSFORM_ACTIONS } from "./ArtifactVersionMenu";

// The menu is a client component; these SSR tests assert the initial rendered
// state (actions visible for native, hidden for legacy, history rows). The
// interactive fetch/restore flow is covered by the route tests + a browser
// smoke test — node has no DOM here, matching the project's other component
// tests (StudyActions, NativeArtifact).

test("renders native edit actions but hides them for legacy artifacts", () => {
  const native = renderToStaticMarkup(
    <ArtifactVersionMenu artifactId="m1:artifact:0" legacy={false} history={[]} onVersionChange={() => {}} />,
  );
  const legacy = renderToStaticMarkup(
    <ArtifactVersionMenu artifactId="m1:artifact:0" legacy history={[]} onVersionChange={() => {}} />,
  );
  assert.match(native, /Simplify/);
  assert.match(native, /Add example/);
  assert.doesNotMatch(legacy, /Simplify/);
  assert.match(legacy, /cannot be safely edited/);
});

test("lists bounded version history with restore controls and marks the active version", () => {
  const history = [
    { id: "v2", instruction: "make it shorter", active: true, created_at: 2_000 },
    { id: "v1", instruction: null, active: false, created_at: 1_000 },
  ];
  const markup = renderToStaticMarkup(
    <ArtifactVersionMenu artifactId="m1:artifact:0" legacy={false} history={history} onVersionChange={() => {}} />,
  );
  assert.match(markup, /Restore version/);
  // The non-active version exposes a restore control; the active one is labeled.
  assert.match(markup, /Version 1/);
  assert.match(markup, /Active/);
});

test("fixed actions are stable and each carries its prompt", () => {
  assert.deepEqual(
    FIXED_TRANSFORM_ACTIONS.map((a) => a.id),
    ["simplify", "add-example", "turn-into-flashcards"],
  );
  for (const action of FIXED_TRANSFORM_ACTIONS) {
    assert.ok(action.prompt.length > 0);
    assert.ok(action.label.length > 0);
  }
});

test("renders the free-form edit input", () => {
  const markup = renderToStaticMarkup(
    <ArtifactVersionMenu artifactId="m1:artifact:0" legacy={false} history={[]} onVersionChange={() => {}} />,
  );
  assert.match(markup, /<input/);
  assert.match(markup, /type="text"/);
});