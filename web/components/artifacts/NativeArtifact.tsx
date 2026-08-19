import { MermaidGraphic } from "@/components/MermaidDiagram";
import type { NativeArtifact as NativeArtifactEnvelope } from "@/lib/artifacts/schema";
import { ArtifactFrame } from "./ArtifactFrame";
import { CalloutArtifact } from "./CalloutArtifact";
import { ChartArtifact } from "./ChartArtifact";
import { ComparisonArtifact } from "./ComparisonArtifact";
import { FigureArtifact } from "./FigureArtifact";
import { StepsArtifact } from "./StepsArtifact";
import { TableArtifact } from "./TableArtifact";
import { ArtifactVersionMenu, type ArtifactHistoryEntry } from "./ArtifactVersionMenu";

export type NativeArtifactVersionOverride = {
  versionId: string;
  artifact: NativeArtifactEnvelope;
  history: ArtifactHistoryEntry[];
};

// Renders a native artifact inside platform chrome. When a `versionOverride`
// is supplied (an edited version persisted via /api/artifacts/[id]), the
// active version's payload replaces the immutable parsed payload and the
// version menu is mounted so the learner can transform/restore it. `legacy`
// flags artifact-html fences so the menu explains they aren't editable.
// `artifactId` is the stable entry id (`${messageId}:artifact:${ordinal}`) the
// menu uses to call the transform/restore endpoints; it is required when
// `onVersionChange` is supplied so the menu can address the right artifact.
export function NativeArtifact({
  artifact,
  artifactId,
  versionOverride,
  legacy,
  onVersionChange,
  onVersionError,
}: {
  artifact: NativeArtifactEnvelope;
  artifactId?: string;
  versionOverride?: NativeArtifactVersionOverride;
  legacy?: boolean;
  onVersionChange?: (result: { versionId: string; artifact: NativeArtifactEnvelope }) => void;
  onVersionError?: (message: string) => void;
}) {
  const active = versionOverride?.artifact ?? artifact;
  const source = JSON.stringify(active);

  return (
    <ArtifactFrame kind={active.kind} title={active.title} summary={active.summary} source={source}>
      {active.kind === "diagram" && <MermaidGraphic code={active.data.mermaid} />}
      {active.kind === "figure" && <FigureArtifact {...active.data} title={active.title} summary={active.summary} />}
      {active.kind === "table" && <TableArtifact columns={active.data.columns} rows={active.data.rows} />}
      {active.kind === "comparison" && <ComparisonArtifact items={active.data.items} />}
      {active.kind === "steps" && <StepsArtifact items={active.data.items} />}
      {active.kind === "callout" && <CalloutArtifact {...active.data} />}
      {active.kind === "chart" && <ChartArtifact {...active.data} title={active.title} summary={active.summary} />}
      {onVersionChange && artifactId && (
        <ArtifactVersionMenu
          artifactId={artifactId}
          legacy={legacy ?? false}
          history={versionOverride?.history ?? []}
          activeVersionId={versionOverride?.versionId ?? null}
          onVersionChange={(result) => onVersionChange(result)}
          onError={onVersionError}
        />
      )}
    </ArtifactFrame>
  );
}

export function InvalidArtifact({ source, reason }: { source: string; reason: string }) {
  return (
    <ArtifactFrame kind="callout" title="Couldn't render artifact" summary={reason}>
      <details className="rounded-control border border-border/70 bg-surface/50 px-3 py-2">
        <summary className="mono cursor-pointer text-[11px] text-content-faint">View source</summary>
        <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-content-muted">{source}</pre>
      </details>
    </ArtifactFrame>
  );
}