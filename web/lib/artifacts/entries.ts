import type { NativeArtifact } from "./schema";
import { classifyArtifact } from "./schema";

export type NativeArtifactEntry = {
  id: string;
  messageId: string;
  ordinal: number;
  artifact: NativeArtifact;
  source: string;
};

export function artifactEntryId(messageId: string, ordinal: number): string {
  return `${messageId}:artifact:${ordinal}`;
}

// Matches the fenced `artifact` / `artifact-html` blocks the renderer routes
// (components/Markdown.tsx: `lang === "artifact" || lang === "artifact-html"`).
// Captures the language and the raw payload between the opening and closing
// fences. Exported so conversation-context can detect legacy HTML fences with
// the exact same parsing shape.
export const ARTIFACT_FENCE_SOURCE =
  "^```(artifact|artifact-html)[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)(?:\\r?\\n```|(?![\\s\\S]))";

export function extractNativeArtifactEntries(
  messageId: string,
  content: string,
): NativeArtifactEntry[] {
  const fence = new RegExp(ARTIFACT_FENCE_SOURCE, "gm");
  const entries: NativeArtifactEntry[] = [];
  let ordinal = 0;

  for (const match of content.matchAll(fence)) {
    const [, language, source] = match;
    // `artifact-html` fences are always legacy HTML — consume the ordinal so
    // sibling positions stay stable, but emit no entry.
    if (language === "artifact") {
      const classification = classifyArtifact(source);
      if (classification.type === "native") {
        entries.push({
          id: artifactEntryId(messageId, ordinal),
          messageId,
          ordinal,
          artifact: classification.artifact,
          source,
        });
      }
    }
    ordinal += 1;
  }

  return entries;
}