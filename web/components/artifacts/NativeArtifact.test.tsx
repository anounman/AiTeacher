import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InvalidArtifact, NativeArtifact } from "./NativeArtifact";
import * as ArtifactFrameModule from "./ArtifactFrame";
import type { NativeArtifact as NativeArtifactEnvelope } from "@/lib/artifacts/schema";

const tableArtifact: NativeArtifactEnvelope = {
  schema: "studygpt.artifact",
  version: 1,
  kind: "table",
  title: "Selection pushdown",
  summary: "Move filters close to the data source.",
  data: {
    columns: ["Rule", "Benefit"],
    rows: [["Push σ down", "Smaller intermediate result"]],
  },
};

test("renders a native table in platform chrome", () => {
  const markup = renderToStaticMarkup(<NativeArtifact artifact={tableArtifact} />);

  assert.match(markup, /Selection pushdown/);
  assert.match(markup, /Data table/);
  assert.match(markup, /Move filters close to the data source\./);
  assert.match(markup, /<th[^>]*>Rule<\/th>/);
});

test("renders each native study renderer semantically", () => {
  const comparisonMarkup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "comparison",
        data: { items: [{ label: "Read", value: "Shared", detail: "No lock" }] },
      }}
    />,
  );
  const stepsMarkup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "steps",
        data: { items: [{ title: "Scan", detail: "Read each tuple", emphasis: "key" }] },
      }}
    />,
  );
  const calloutMarkup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "callout",
        data: { label: "Key idea", body: "Selection reduces relation size.", tone: "idea" },
      }}
    />,
  );
  const chartMarkup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "chart",
        title: "Query cost",
        data: {
          chartType: "line",
          labels: ["Before", "After"],
          series: [{ label: "Rows", values: [100, 20] }],
        },
      }}
    />,
  );

  assert.match(comparisonMarkup, /Read/);
  assert.match(stepsMarkup, /<ol[^>]*>/);
  assert.match(stepsMarkup, /Scan/);
  assert.match(calloutMarkup, /Selection reduces relation size\./);
  assert.match(chartMarkup, /role="img"/);
  assert.match(chartMarkup, /Query cost/);
  assert.match(chartMarkup, /Rows/);
  assert.match(chartMarkup, /data-chart-tick/);
  assert.match(chartMarkup, /data-chart-grid/);
});

test("renders invalid source in a compact fallback", () => {
  const markup = renderToStaticMarkup(
    <InvalidArtifact source="{invalid" reason="Source is not valid JSON" />,
  );

  assert.match(markup, /Couldn&#x27;t render artifact/);
  assert.match(markup, /Source is not valid JSON/);
  assert.match(markup, /<details/);
  assert.match(markup, /\{invalid/);
});

test("uses unique chart labels and a zero baseline for negative bar values", () => {
  const artifact: NativeArtifactEnvelope = {
    schema: "studygpt.artifact",
    version: 1,
    kind: "chart",
    title: "Balance",
    data: {
      chartType: "bar",
      labels: ["Credit", "Debit"],
      series: [{ label: "Amount", values: [12, -8] }],
    },
  };
  const markup = renderToStaticMarkup(<><NativeArtifact artifact={artifact} /><NativeArtifact artifact={artifact} /></>);
  const chartTitleIds = [...markup.matchAll(/<title id="([^"]+)"/g)].map((match) => match[1]);

  assert.equal(new Set(chartTitleIds).size, 2);
  assert.doesNotMatch(markup, /height="-/);
});

test("keeps artifact frames gently animated and charts fluid", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
        schema: "studygpt.artifact",
        version: 1,
        kind: "chart",
        data: {
          chartType: "line",
          labels: ["Before", "After"],
          series: [{ label: "Rows", values: [100, 20] }],
        },
      }}
    />,
  );

  assert.match(markup, /animate-in/);
  assert.match(markup, /duration-150/);
  assert.match(markup, /w-full/);
  assert.doesNotMatch(markup, /min-w-\[28rem\]/);
});

test("handles rejected clipboard writes without surfacing an error", async () => {
  const copyArtifactSource = (
    ArtifactFrameModule as typeof ArtifactFrameModule & {
      copyArtifactSource?: (source: string) => Promise<boolean>;
    }
  ).copyArtifactSource;
  assert.equal(typeof copyArtifactSource, "function");
  if (!copyArtifactSource) return;

  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error("Denied"); } } },
  });
  try {
    assert.equal(await copyArtifactSource("native envelope"), false);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});

test("renders a Chen-style ER figure as inline SVG with shapes and connectors", () => {
  const markup = renderToStaticMarkup(
    <NativeArtifact
      artifact={{
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
          legend: [{ label: "relationship", swatch: "diamond" }],
        },
      }}
    />,
  );

  assert.match(markup, /role="img"/);
  assert.match(markup, /Chen-style ER/);
  assert.match(markup, /STUDENT/);
  assert.match(markup, /<polygon/); // diamond
  assert.match(markup, /<rect/); // entity boxes
  assert.match(markup, /<line/); // connectors
  assert.match(markup, /cardinality|1|N/);
  assert.match(markup, /relationship/); // legend
});
