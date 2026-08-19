"use client";

import { BookOpen } from "lucide-react";
import type { SourceEntry } from "@/lib/db/schema";

export function dedupeSources(sources: SourceEntry[]): SourceEntry[] {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.materialId}:${source.ordinal}:${source.page ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function SourceCitationStrip({
  sources,
  onOpenSource,
}: {
  sources: SourceEntry[];
  onOpenSource?: (source: SourceEntry) => void;
}) {
  const citations = dedupeSources(sources);
  if (!citations.length) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Sources">
      {citations.map((source) => (
        <button
          key={`${source.materialId}:${source.ordinal}:${source.page ?? ""}`}
          type="button"
          onClick={() => onOpenSource?.(source)}
          className="mono inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] tracking-wide text-content-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BookOpen size={11} aria-hidden />
          <span className="truncate">{source.title}</span>
          {Number.isInteger(source.page) && source.page! > 0 && <span>p. {source.page}</span>}
        </button>
      ))}
    </div>
  );
}
