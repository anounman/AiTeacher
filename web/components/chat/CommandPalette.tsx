"use client";

import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import type { GlobalSearchResult } from "@/lib/chat/global-search";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  results: GlobalSearchResult[];
  loading?: boolean;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (result: GlobalSearchResult) => void;
};

type BodyProps = Omit<Props, "open" | "onOpenChange"> & {
  onDismiss?: () => void;
};

const GROUPS: Array<{ kind: GlobalSearchResult["kind"]; label: string }> = [
  { kind: "conversation", label: "Conversations" },
  { kind: "message", label: "Messages" },
  { kind: "material", label: "Materials" },
  { kind: "concept", label: "Concepts" },
  { kind: "overlay", label: "Saved discussions" },
  { kind: "artifact", label: "Artifacts" },
];

function resultLabel(result: GlobalSearchResult): string {
  switch (result.kind) {
    case "conversation": return "Conversation";
    case "message": return "Message";
    case "material": return "Material";
    case "concept": return "Concept";
    case "overlay": return "Saved discussion";
    case "artifact": return "Artifact";
  }
}

export function movePaletteSelection(currentIndex: number, count: number, direction: "up" | "down"): number {
  if (count === 0) return -1;
  if (direction === "down") return currentIndex >= count - 1 ? 0 : Math.max(currentIndex, -1) + 1;
  return currentIndex <= 0 ? count - 1 : currentIndex - 1;
}

export function CommandPalette({ open, onOpenChange, ...props }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(78dvh,38rem)] w-[min(94vw,44rem)] max-w-none flex-col overflow-hidden p-0" showClose>
        <CommandPaletteBody {...props} onDismiss={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function CommandPaletteBody({
  query,
  onQueryChange,
  results,
  loading = false,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  onDismiss,
}: BodyProps) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onActiveIndexChange(movePaletteSelection(activeIndex, results.length, "down"));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onActiveIndexChange(movePaletteSelection(activeIndex, results.length, "up"));
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      onSelect(results[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onDismiss?.();
    }
  };

  return (
    <>
      <DialogHeader className="border-b border-border px-5 py-4">
        <DialogTitle>Search everything</DialogTitle>
        <DialogDescription>Find conversations, materials, concepts, saved discussions, and artifacts</DialogDescription>
      </DialogHeader>
      <div className="px-5 pt-4">
        <label className="relative block">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search everything"
            aria-label="Search everything"
            className="pl-9"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 scrollbar-thin" role="listbox" aria-label="Search results">
        {loading ? (
          <p className="px-2 py-5 text-center text-[13px] text-content-muted">Searching…</p>
        ) : query.trim().length < 2 ? (
          <p className="px-2 py-5 text-center text-[13px] text-content-muted">Type at least two characters to search.</p>
        ) : results.length === 0 ? (
          <p className="px-2 py-5 text-center text-[13px] text-content-muted">No matching results.</p>
        ) : (
          <div className="space-y-4">
            {GROUPS.map((group) => {
              const grouped = results.map((result, index) => ({ result, index })).filter(({ result }) => result.kind === group.kind);
              if (grouped.length === 0) return null;
              return (
                <section key={group.kind} aria-label={group.label}>
                  <h3 className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-content-faint">{group.label}</h3>
                  <ul className="space-y-1">
                    {grouped.map(({ result, index }) => (
                      <li key={`${result.kind}-${index}`} role="option" aria-selected={index === activeIndex}>
                        <button
                          type="button"
                          onMouseEnter={() => onActiveIndexChange(index)}
                          onClick={() => onSelect(result)}
                          className={`w-full rounded-control px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring outline-none ${index === activeIndex ? "bg-surface-2" : "hover:bg-surface-2"}`}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="truncate text-[13px] font-medium text-content">{result.title}</span>
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-content-faint">{resultLabel(result)}</span>
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-[12px] leading-relaxed text-content-muted">{result.snippet}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-2 text-[11px] text-content-faint">
        <span>↑↓ to move</span><span>↵ to open</span><span>Esc to close</span>
      </div>
    </>
  );
}
