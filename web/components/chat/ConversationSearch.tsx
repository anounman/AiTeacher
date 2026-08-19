"use client";

import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import type { ConversationSearchResult } from "@/lib/chat/conversation-search";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: ConversationSearchResult) => void;
  results: ConversationSearchResult[];
  query?: string;
  onQueryChange?: (query: string) => void;
  loading?: boolean;
};

export function ConversationSearch({
  open,
  onOpenChange,
  onSelect,
  results,
  query = "",
  onQueryChange,
  loading = false,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(78dvh,38rem)] w-[min(94vw,40rem)] max-w-none flex-col overflow-hidden p-0" showClose>
        <ConversationSearchBody query={query} onQueryChange={onQueryChange} results={results} onSelect={onSelect} loading={loading} />
      </DialogContent>
    </Dialog>
  );
}

export function ConversationSearchBody({
  query = "",
  onQueryChange,
  onSelect,
  results,
  loading = false,
}: Pick<Props, "query" | "onQueryChange" | "onSelect" | "results" | "loading">) {
  return (
    <>
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Search conversations</DialogTitle>
          <DialogDescription>Search titles and messages</DialogDescription>
        </DialogHeader>
        <div className="px-5 pt-4">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => onQueryChange?.(event.target.value)}
              placeholder="Search your study history…"
              className="pl-9"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading && <p className="mono px-2 py-4 text-[11px] text-content-faint">searching…</p>}
          {!loading && query.trim().length > 0 && results.length === 0 && (
            <p className="mono px-2 py-4 text-[11px] text-content-faint">no matching conversations</p>
          )}
          {!loading && query.trim().length > 0 && results.length > 0 && (
            <ul className="space-y-1">
              {results.map((result) => (
                <li key={`${result.conversationId}:${result.messageId ?? "title"}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(result)}
                    className="w-full rounded-control px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring outline-none"
                  >
                    <span className="block truncate text-[13px] font-medium text-content">{result.conversationTitle}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[12px] leading-relaxed text-content-muted">{result.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
    </>
  );
}
