import assert from "node:assert/strict";
import test from "node:test";
import { artifactKindLabel, artifactKindListPrompt, classifyArtifact } from "./schema";
import { registerKind, resolveKindCandidates } from "./registry";

test("classifies a versioned table envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "table",
      title: "Selection pushdown",
      data: { columns: ["Rule"], rows: [["Push σ down"]] },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "table");
});

test("classifies a Mermaid envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "diagram",
      data: { mermaid: "flowchart LR\n  A --> B" },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "diagram");
});

test("classifies a comparison envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "comparison",
      data: { items: [{ label: "Latency", value: "Lower", detail: "Fewer round trips" }] },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "comparison");
});

test("classifies a steps envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "steps",
      data: { items: [{ title: "Parse", detail: "Read the input", emphasis: "key" }] },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "steps");
});

test("classifies a callout envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "callout",
      data: { label: "Idea", body: "Cache the result", tone: "idea" },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "callout");
});

test("classifies a chart envelope as native", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "chart",
      data: {
        chartType: "bar",
        labels: ["Before", "After"],
        series: [{ label: "Latency", values: [12, 7] }],
      },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "chart");
});

test("normalizes the chart shape generated for dated series", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart",
    data: {
      chartType: "line", title: "India's nominal GDP",
      xAxis: { label: "Year", values: ["1995", "1996", "1997"] },
      yAxis: { label: "GDP (USD billions)" },
      series: [{ name: "Nominal GDP", color: "#2563eb", values: [360, 393, 416] }],
    },
  }));

  assert.equal(result.type, "native");
  assert.deepEqual(result.type === "native" && result.artifact.data, {
    chartType: "line",
    labels: ["1995", "1996", "1997"],
    series: [{ label: "Nominal GDP", values: [360, 393, 416] }],
  });
  assert.equal(result.type === "native" && result.artifact.title, "India's nominal GDP");
});

test("normalizes labeled chart metadata and named series", () => {
  const result = classifyArtifact(JSON.stringify({
    schema: "studygpt.artifact", version: 1, kind: "chart", title: "India GDP",
    data: { chartType: "line", xLabel: "Year", yLabel: "USD", labels: ["2023", "2024"], series: [{ name: "GDP", color: "#4C8BF5", values: [3500, 3761] }] },
  }));

  assert.equal(result.type, "native");
  assert.deepEqual(result.type === "native" && result.artifact.data, {
    chartType: "line", labels: ["2023", "2024"], series: [{ label: "GDP", values: [3500, 3761] }],
  });
});

test("classifies legacy HTML without parsing it as native JSON", () => {
  const html = "<!doctype html><html><body>Legacy</body></html>";
  const result = classifyArtifact(`  ${html}  `);

  assert.deepEqual(result, { type: "legacy-html", html });
});

test("rejects an unknown native kind", () => {
  const source = JSON.stringify({
    schema: "studygpt.artifact",
    version: 1,
    kind: "timeline",
    data: {},
  });

  const result = classifyArtifact(source);

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /kind/i);
});

test("rejects malformed JSON", () => {
  const result = classifyArtifact('{"schema":"studygpt.artifact"');

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /JSON/i);
});

test("rejects a payload missing schema", () => {
  const result = classifyArtifact(
    JSON.stringify({
      version: 1,
      kind: "callout",
      data: { body: "Remember this" },
    }),
  );

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /schema/i);
});

test("rejects a table exceeding the row limit", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "table",
      data: {
        columns: ["Value"],
        rows: Array.from({ length: 61 }, (_, index) => [index]),
      },
    }),
  );

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /rows/i);
});

test("enforces strict markup, length, and shape limits", () => {
  const cases = [
    {
      name: "markup key",
      payload: {
        schema: "studygpt.artifact",
        version: 1,
        kind: "callout",
        html: "<b>unsafe</b>",
        data: { body: "Safe" },
      },
    },
    {
      name: "title length",
      payload: {
        schema: "studygpt.artifact",
        version: 1,
        kind: "callout",
        title: "x".repeat(161),
        data: { body: "Safe" },
      },
    },
    {
      name: "cell length",
      payload: {
        schema: "studygpt.artifact",
        version: 1,
        kind: "table",
        data: { columns: ["Value"], rows: [["x".repeat(1001)]] },
      },
    },
    {
      name: "unknown field",
      payload: {
        schema: "studygpt.artifact",
        version: 1,
        kind: "callout",
        data: { body: "Safe", extra: true },
      },
    },
  ];

  for (const { name, payload } of cases) {
    const result = classifyArtifact(JSON.stringify(payload));
    assert.equal(result.type, "invalid", name);
  }
});

test("labels every native artifact kind", () => {
  assert.equal(artifactKindLabel("diagram"), "Diagram");
  assert.equal(artifactKindLabel("table"), "Data table");
  assert.equal(artifactKindLabel("comparison"), "Comparison");
  assert.equal(artifactKindLabel("steps"), "Steps");
  assert.equal(artifactKindLabel("callout"), "Callout");
  assert.equal(artifactKindLabel("chart"), "Chart");
});

// Alias recovery: an ad-hoc model-emitted kind like `erm`/`flowchart`/`graph`
// normalizes to a native kind instead of producing a dead-end "unsupported
// kind". The canonical kind's validator must still accept the payload —
// recovery, not silent acceptance. This is the direct fix for the
// "ERM → artifact not supported" failure.
test("normalizes an ad-hoc `erm` kind with Mermaid data to a native diagram", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "erm",
      data: { mermaid: "erDiagram\n  STUDENT ||--o{ ENROLLMENT : has" },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "diagram");
});

test("normalizes ad-hoc flowchart/sequence/class/state aliases to a native diagram", () => {
  for (const kind of ["flowchart", "sequence-diagram", "class-diagram", "state-machine"]) {
    const result = classifyArtifact(
      JSON.stringify({
        schema: "studygpt.artifact",
        version: 1,
        kind,
        data: { mermaid: "flowchart LR\n  A --> B" },
      }),
    );
    assert.equal(result.type, "native", kind);
    assert.equal(result.type === "native" && result.artifact.kind, "diagram", kind);
  }
});

test("normalizes an ad-hoc `graph` kind to a native diagram", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "precedence-graph",
      data: { mermaid: "flowchart LR\n  T1 --> T2" },
    }),
  );

  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "diagram");
});

test("an aliased kind whose data the target validator rejects still falls to invalid", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "erm",
      data: { entities: [{ name: "STUDENT" }] },
    }),
  );

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /mermaid/i);
});

test("a genuinely unknown kind with no alias is still invalid", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "timeline",
      data: { items: [] },
    }),
  );

  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /kind/i);
});

// The prompt's kind list is derived from the registry, so it can never drift
// from the validators. Every registered kind appears with its data-shape hint.
test("artifactKindListPrompt lists every registered kind with its data shape", () => {
  const list = artifactKindListPrompt();
  for (const kind of ["diagram", "figure", "table", "comparison", "steps", "callout", "chart"]) {
    assert.match(list, new RegExp(`\\b${kind} \\(`), `kind ${kind} in list`);
  }
  assert.match(list, /mermaid:string/);
  assert.match(list, /chartType/);
  assert.match(list, /shapes/);
});

// --- figure kind (notation-faithful vector DSL) ---------------------------

const chenErFigure = {
  schema: "studygpt.artifact",
  version: 1,
  kind: "figure",
  title: "Chen-style ER",
  data: {
    width: 520,
    height: 300,
    shapes: [
      { id: "s", type: "rect", x: 40, y: 120, w: 120, h: 60, label: "STUDENT", kind: "entity" },
      { id: "e", type: "rect", x: 360, y: 120, w: 120, h: 60, label: "ENROLLS", kind: "entity" },
      { id: "r", type: "diamond", x: 240, y: 110, w: 80, h: 80, label: "has", kind: "relationship" },
    ],
    connectors: [
      { id: "c1", from: "s", to: "r", style: "solid", arrow: "none", cardinality: "1" },
      { id: "c2", from: "r", to: "e", style: "solid", arrow: "none", cardinality: "N" },
    ],
    legend: [{ label: "relationship", swatch: "diamond" }, { label: "entity", swatch: "rect" }],
  },
};

test("classifies a Chen-style ER figure as native", () => {
  const result = classifyArtifact(JSON.stringify(chenErFigure));
  assert.equal(result.type, "native");
  assert.ok(result.type === "native" && result.artifact.kind === "figure");
  assert.equal(result.type === "native" && result.artifact.kind === "figure" && result.artifact.data.shapes.length, 3);
});

test("an ad-hoc `erm` carrying figure DSL data routes to figure, not diagram", () => {
  const result = classifyArtifact(JSON.stringify({ ...chenErFigure, kind: "erm" }));
  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "figure");
});

test("an ad-hoc `erm` carrying Mermaid data falls back to diagram", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "erm",
      data: { mermaid: "erDiagram\n  STUDENT ||--o{ ENROLLMENT : has" },
    }),
  );
  assert.equal(result.type, "native");
  assert.equal(result.type === "native" && result.artifact.kind, "diagram");
});

test("rejects a figure with no shapes", () => {
  const result = classifyArtifact(
    JSON.stringify({ schema: "studygpt.artifact", version: 1, kind: "figure", data: { shapes: [] } }),
  );
  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /shapes/i);
});

test("rejects a figure connector referencing a non-existent shape", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "figure",
      data: {
        shapes: [{ id: "a", type: "rect", x: 10, y: 10, w: 80, h: 40 }],
        connectors: [{ id: "c", from: "a", to: "missing", style: "solid" }],
      },
    }),
  );
  assert.equal(result.type, "invalid");
  assert.match(result.type === "invalid" ? result.reason : "", /connector/i);
});

test("rejects a figure with an invalid shape type", () => {
  const result = classifyArtifact(
    JSON.stringify({
      schema: "studygpt.artifact",
      version: 1,
      kind: "figure",
      data: { shapes: [{ id: "a", type: "hexagon", x: 10, y: "10", w: 80, h: 40 }] },
    }),
  );
  assert.equal(result.type, "invalid");
});

// HMR safety: Next's Turbopack dev re-evaluates the side-effect kind modules
// (kinds/index.ts → kinds/*.ts) against the already-populated registry. A hard
// throw on repeat registration crashes the client module graph and React
// hydration fails — the symptom is "the page loads but nothing is clickable",
// which is exactly the bug this guard prevents. Re-registering the same kind
// (or the same alias) must be a no-op, not an error.
test("registerKind is idempotent — re-registering a kind does not throw (HMR-safe)", () => {
  assert.doesNotThrow(() => {
    registerKind({
      kind: "diagram",
      label: "Diagram",
      promptSpec: `data:{mermaid:string}`,
      aliases: ["flowchart"],
      validate: () => ({ ok: false as const, reason: "test stub" }),
    });
  });
  // The canonical diagram kind is still resolvable and its alias candidate
  // list has not been corrupted or reordered by the re-registration.
  assert.ok(resolveKindCandidates("flowchart").includes("diagram"));
  assert.equal(resolveKindCandidates("flowchart")[0], "diagram");
});
