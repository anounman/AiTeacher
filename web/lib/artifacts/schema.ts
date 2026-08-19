// Public surface for native artifacts. Re-exports the runtime registry
// (`classifyArtifact`, `artifactKindLabel`) and assembles the typed
// `NativeArtifact` discriminated union from the per-kind data types declared
// in `./kinds/*`. Importing `./kinds/index` runs each kind module's
// `registerKind` side effect so the registry is populated before any
// classification runs.
//
// Adding a kind: create `./kinds/<name>.ts` (call `registerKind`), add it to
// `./kinds/index.ts`, add its `Data` import + a union member below, and add
// its `kind` literal to `NativeArtifactKind`. Five touch points — but each is
// a one-line addition, and the prompt spec / transform prompt kind lists are
// derived from the registry at runtime so they never drift.

import "./kinds/index";
import { classifyArtifact as classifyArtifactBase, artifactKindLabel as artifactKindLabelBase } from "./registry";

export { NATIVE_ARTIFACT_SCHEMA, NATIVE_ARTIFACT_VERSION, artifactKindListPrompt } from "./registry";
import type { NATIVE_ARTIFACT_SCHEMA, NATIVE_ARTIFACT_VERSION } from "./registry";
import type { DiagramData } from "./kinds/diagram";
import type { FigureData } from "./kinds/figure";
import type { TableData } from "./kinds/table";
import type { ComparisonData } from "./kinds/comparison";
import type { StepsData } from "./kinds/steps";
import type { CalloutData } from "./kinds/callout";
import type { ChartData } from "./kinds/chart";

export type NativeArtifactKind =
  | "diagram"
  | "figure"
  | "table"
  | "comparison"
  | "steps"
  | "callout"
  | "chart";

export type NativeArtifact =
  | { schema: typeof NATIVE_ARTIFACT_SCHEMA; version: typeof NATIVE_ARTIFACT_VERSION; kind: "diagram"; title?: string; summary?: string; data: DiagramData }
  | { schema: typeof NATIVE_ARTIFACT_SCHEMA; version: typeof NATIVE_ARTIFACT_VERSION; kind: "figure"; title?: string; summary?: string; data: FigureData }
  | { schema: typeof NATIVE_ARTIFACT_SCHEMA; version: typeof NATIVE_ARTIFACT_VERSION; kind: "table"; title?: string; summary?: string; data: TableData }
  | { schema: typeof NATIVE_ARTIFACT_SCHEMA; version: typeof NATIVE_ARTIFACT_VERSION; kind: "comparison"; title?: string; summary?: string; data: ComparisonData }
  | { schema: typeof NATIVE_ARTIFACT_SCHEMA; version: typeof NATIVE_ARTIFACT_VERSION; kind: "steps"; title?: string; summary?: string; data: StepsData }
  | { schema: typeof NATIVE_ARTIFACT_SCHEMA; version: typeof NATIVE_ARTIFACT_VERSION; kind: "callout"; title?: string; summary?: string; data: CalloutData }
  | { schema: typeof NATIVE_ARTIFACT_SCHEMA; version: typeof NATIVE_ARTIFACT_VERSION; kind: "chart"; title?: string; summary?: string; data: ChartData };

export type ArtifactClassification =
  | { type: "native"; artifact: NativeArtifact }
  | { type: "legacy-html"; html: string }
  | { type: "invalid"; source: string; reason: string };

// The registry returns a loosely-typed `artifact` (kind: string, data:
// unknown); each kind validator's `T` matches the corresponding union member's
// `data` shape, so this narrowing cast is sound.
export function classifyArtifact(source: string): ArtifactClassification {
  return classifyArtifactBase(source) as ArtifactClassification;
}

export function artifactKindLabel(kind: NativeArtifactKind): string {
  return artifactKindLabelBase(kind);
}
