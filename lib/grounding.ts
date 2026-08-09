import type { SourceEntry } from "@/lib/db/schema";

// Remove hallucinated source IDs before an answer is persisted. The live
// stream is still optimistic, but reload/export/history can never present a
// forged marker as if it came from retrieval.
export function sanitizeSourceMarkers(text: string, sources: SourceEntry[]): string {
  const allowed = new Set(sources.map((source) => source.sourceId).filter(Boolean));
  let validCount = 0;
  const clean = text.replace(/\[S:([a-zA-Z0-9_-]+)\]/g, (marker, id: string) => {
    if (!allowed.has(id)) return "";
    validCount += 1;
    return marker;
  }).replace(/[ \t]+\n/g, "\n").trimEnd();
  if (!allowed.size || validCount > 0) return clean;
  const reviewed = sources.slice(0, 4).map((source) => `[S:${source.sourceId}]`).join(" ");
  return `${clean}\n\nSources reviewed: ${reviewed}`.trim();
}
